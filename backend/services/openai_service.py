import base64
import logging
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from openai import OpenAI, OpenAIError
from PIL import Image, ImageOps

from models.schemas import ImageRequest
from services.settings_service import get_model_config, get_runtime_config, normalize_provider
from services.token_usage_service import estimate_text_tokens, extract_usage_dict

load_dotenv()

logger = logging.getLogger(__name__)


class OpenAIServiceError(RuntimeError):
    pass


SYSTEM_PROMPT = """You are a professional AI creation assistant. Answer clearly, accurately, and with structured Markdown.

When the user message includes attachments (images, files, or extracted text blocks), treat them as part of the user request. Analyze image contents when images are provided. Use extracted file text when available. Never claim you cannot see attachments if attachment content is present in the message.

Return in this format:
<ai_thought_summary>
Give a brief, user-visible reasoning summary with 1-5 concise bullets. Do not reveal private chain-of-thought.
</ai_thought_summary>

<ai_answer>
Write the final answer here. Use clean Markdown, tables, lists, and fenced code blocks when useful. For math, use LaTeX delimiters: inline math as $...$ and display math as $$...$$.
</ai_answer>
"""


STYLE_PROMPTS = {
    "\u5199\u5b9e": "photorealistic, premium commercial visual, realistic lighting",
    "\u52a8\u6f2b": "anime style, crisp line art, expressive color, polished composition",
    "3D": "high-end 3D render, cinematic lighting, detailed materials",
    "\u6cb9\u753b": "oil painting, layered brush texture, gallery-quality composition",
    "\u4ea7\u54c1\u56fe": "premium product photography, clean studio background, soft shadows",
    "\u6444\u5f71": "professional photography, editorial lighting, refined details",
}

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
IMAGE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


class OpenAIService:
    def __init__(self, provider: str = "openai") -> None:
        self.provider = normalize_provider(provider)
        base_url, api_key = get_runtime_config(self.provider)
        if not api_key:
            raise OpenAIServiceError(f"{self.provider.upper()} API key is not configured")
        self.client = OpenAI(api_key=api_key, base_url=base_url)
        self.text_model, self.image_model = get_model_config(self.provider)

    def _usage_payload(self, response: object, *, fallback_text: str = "") -> dict[str, int]:
        usage = extract_usage_dict(response)
        if usage["total_tokens"] > 0:
            return usage

        prompt_tokens = estimate_text_tokens(fallback_text)
        completion_tokens = max(1, prompt_tokens // 2) if prompt_tokens else 0
        total_tokens = prompt_tokens + completion_tokens
        return {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
        }

    def _result_payload(self, text: str, response: object | None = None, *, fallback_text: str = "") -> dict[str, Any]:
        usage = self._usage_payload(response, fallback_text=fallback_text or text) if response is not None else {
            "prompt_tokens": estimate_text_tokens(fallback_text or text),
            "completion_tokens": estimate_text_tokens(text),
            "total_tokens": 0,
        }
        if usage["total_tokens"] <= 0:
            prompt_tokens = estimate_text_tokens(fallback_text or text)
            completion_tokens = estimate_text_tokens(text)
            usage = {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            }
        return {
            "text": text,
            "model": self.text_model,
            "prompt_tokens": usage["prompt_tokens"],
            "completion_tokens": usage["completion_tokens"],
            "total_tokens": usage["total_tokens"],
        }

    def _extract_responses_text(self, response: Any) -> str:
        output_text = getattr(response, "output_text", None)
        if isinstance(output_text, str) and output_text.strip():
            return output_text.strip()

        model_dump = response.model_dump() if hasattr(response, "model_dump") else response
        if not isinstance(model_dump, dict):
            return ""

        text_parts: list[str] = []
        for output_item in model_dump.get("output") or []:
            for content_item in output_item.get("content") or []:
                text = content_item.get("text")
                if isinstance(text, str) and text.strip():
                    text_parts.append(text.strip())
        return "\n".join(text_parts).strip()

    @staticmethod
    def _is_image_attachment(item: dict[str, str | int | None]) -> bool:
        content_type = str(item.get("content_type") or "").lower()
        if content_type.startswith("image/"):
            return True
        filename = str(item.get("filename") or "")
        return Path(filename).suffix.lower() in IMAGE_EXTENSIONS

    @staticmethod
    def _image_mime(item: dict[str, str | int | None]) -> str:
        content_type = str(item.get("content_type") or "").lower()
        if content_type.startswith("image/"):
            return content_type
        filename = str(item.get("filename") or "")
        return IMAGE_MIME.get(Path(filename).suffix.lower(), "image/png")

    def _attachment_text_blocks(self, attachments: list[dict[str, str | int | None]]) -> list[str]:
        blocks: list[str] = []
        for item in attachments:
            filename = str(item.get("filename") or "attachment")
            content_type = str(item.get("content_type") or "application/octet-stream")
            text_content = item.get("text_content")
            if isinstance(text_content, str) and text_content.strip():
                blocks.append(f"### File: {filename}\n{text_content.strip()}")
            elif self._is_image_attachment(item):
                blocks.append(f"[Image attachment: {filename} ({content_type})]")
            else:
                blocks.append(
                    f"[Uploaded file: {filename} ({content_type}). "
                    "Binary content was not extracted as text; answer based on the filename and user request.]"
                )
        return blocks

    def _compose_user_text(
        self,
        message: str,
        attachments: list[dict[str, str | int | None]] | None,
        *,
        include_image_placeholders: bool = True,
        images_sent_separately: bool = False,
    ) -> str:
        parts = [message.strip() or "Please analyze the attached files."]
        if not attachments:
            return parts[0]
        blocks = []
        for item in attachments:
            filename = str(item.get("filename") or "attachment")
            content_type = str(item.get("content_type") or "application/octet-stream")
            text_content = item.get("text_content")
            if isinstance(text_content, str) and text_content.strip():
                blocks.append(
                    f"### File: {filename} ({content_type})\n"
                    f"Extracted text content follows. Use this as the document body:\n\n"
                    f"{text_content.strip()}"
                )
            elif self._is_image_attachment(item):
                if images_sent_separately:
                    blocks.append(f"[Image attached below as vision input: {filename} ({content_type})]")
                elif include_image_placeholders:
                    blocks.append(
                        f"[Image attachment: {filename} ({content_type}). "
                        "Image binary was not delivered to the vision channel; "
                        "tell the user to retry if visual analysis is required.]"
                    )
            else:
                blocks.append(
                    f"[Uploaded file: {filename} ({content_type}, size={item.get('file_size') or 'unknown'}). "
                    "Binary content could not be extracted as text. "
                    "If this is a Word/PDF/Excel/PPT file, ask the user to re-upload after conversion, "
                    "or explain that extraction failed.]"
                )
        if blocks:
            parts.append(
                "The user uploaded the following attachments. Use them when answering:\n"
                + "\n\n".join(blocks)
            )
        return "\n\n".join(parts)

    def _normalize_history(self, history: list[dict[str, str]] | None) -> list[dict[str, str]]:
        normalized: list[dict[str, str]] = []
        for item in history or []:
            role = str(item.get("role") or "").strip()
            content = item.get("content")
            if role not in {"user", "assistant", "system"}:
                continue
            if not isinstance(content, str):
                content = str(content or "")
            content = content.strip()
            if not content:
                continue
            normalized.append({"role": role, "content": content})
        return normalized

    def _chat_completion_messages(
        self,
        message: str,
        history: list[dict[str, str]] | None,
        attachments: list[dict[str, str | int | None]] | None,
        *,
        multimodal: bool,
    ) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
        messages.extend(self._normalize_history(history))

        if not attachments:
            messages.append({"role": "user", "content": message})
            return messages

        if not multimodal:
            messages.append(
                {
                    "role": "user",
                    "content": self._compose_user_text(message, attachments, include_image_placeholders=True),
                }
            )
            return messages

        image_parts: list[dict[str, Any]] = []
        for item in attachments:
            data_url = item.get("data_url")
            if isinstance(data_url, str) and data_url.startswith("data:image"):
                image_parts.append({"type": "image_url", "image_url": {"url": data_url}})

        if not image_parts:
            # No real images to send; pure text is safer for non-vision models.
            messages.append(
                {
                    "role": "user",
                    "content": self._compose_user_text(message, attachments, include_image_placeholders=True),
                }
            )
            return messages

        content_parts: list[dict[str, Any]] = [
            {
                "type": "text",
                "text": self._compose_user_text(
                    message,
                    attachments,
                    include_image_placeholders=True,
                    images_sent_separately=True,
                ),
            },
            *image_parts,
        ]
        messages.append({"role": "user", "content": content_parts})
        return messages

    def _fallback_prompt_text(
        self,
        message: str,
        history: list[dict[str, str]] | None,
        attachments: list[dict[str, str | int | None]] | None,
    ) -> str:
        parts = [SYSTEM_PROMPT]
        for item in self._normalize_history(history):
            parts.append(item["content"])
        parts.append(self._compose_user_text(message, attachments, include_image_placeholders=True))
        return "\n".join(parts)

    def _chat_with_completions(
        self,
        message: str,
        history: list[dict[str, str]] | None = None,
        attachments: list[dict[str, str | int | None]] | None = None,
        *,
        multimodal: bool = True,
    ) -> dict[str, Any]:
        response = self.client.chat.completions.create(
            model=self.text_model,
            messages=self._chat_completion_messages(message, history, attachments, multimodal=multimodal),
        )
        choice = response.choices[0] if response.choices else None
        text = choice.message.content if choice and choice.message else None
        if isinstance(text, str) and text.strip():
            return self._result_payload(
                text.strip(),
                response,
                fallback_text=self._fallback_prompt_text(message, history, attachments),
            )
        raise OpenAIServiceError("模型返回了空回复")

    def chat(
        self,
        message: str,
        history: list[dict[str, str]] | None = None,
        attachments: list[dict[str, str | int | None]] | None = None,
    ) -> dict[str, Any]:
        """Chat with optional attachments.

        Strategy:
        1. With attachments → prefer chat.completions (broader proxy support).
        2. Multimodal first when images present; fall back to text-only description.
        3. Without attachments → try Responses API, then completions.
        """
        fallback_text = self._fallback_prompt_text(message, history, attachments)
        has_attachments = bool(attachments)
        has_images = any(
            self._is_image_attachment(item) and isinstance(item.get("data_url"), str) and str(item.get("data_url")).startswith("data:image")
            for item in (attachments or [])
        )

        if has_attachments:
            if not has_images:
                try:
                    return self._chat_with_completions(message, history, attachments, multimodal=False)
                except (OpenAIError, OpenAIServiceError) as exc:
                    raise OpenAIServiceError(str(exc)) from exc
            try:
                return self._chat_with_completions(message, history, attachments, multimodal=True)
            except (OpenAIError, OpenAIServiceError) as first_exc:
                logger.warning("Multimodal/attachment chat failed, retrying text-only: %s", first_exc)
                try:
                    return self._chat_with_completions(message, history, attachments, multimodal=False)
                except (OpenAIError, OpenAIServiceError) as second_exc:
                    raise OpenAIServiceError(str(second_exc)) from second_exc

        try:
            response = self.client.responses.create(
                model=self.text_model,
                input=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    *self._normalize_history(history),
                    {"role": "user", "content": message},
                ],
            )
            text = self._extract_responses_text(response)
            if text:
                return self._result_payload(text, response, fallback_text=fallback_text)
            return self._chat_with_completions(message, history, None, multimodal=False)
        except OpenAIError:
            try:
                return self._chat_with_completions(message, history, None, multimodal=False)
            except OpenAIError as exc:
                raise OpenAIServiceError(str(exc)) from exc

    def _extract_image_base64(self, result: Any) -> str:
        if not getattr(result, "data", None):
            raise OpenAIServiceError("Image API returned empty data")

        first = result.data[0]
        image_base64 = getattr(first, "b64_json", None)
        if image_base64:
            return image_base64

        image_url = getattr(first, "url", None)
        if image_url:
            response = httpx.get(image_url, timeout=60)
            response.raise_for_status()
            return base64.b64encode(response.content).decode("ascii")

        raise OpenAIServiceError("Image API returned no b64_json or url")

    def _openai_generation_size(self, target_size: str) -> str:
        if self.image_model.startswith("gpt-image-2"):
            width, height = parse_image_size(target_size)
            if width * height <= 8_294_400:
                return target_size

        width, height = parse_image_size(target_size)
        if width > height:
            return "1536x1024"
        if height > width:
            return "1024x1536"
        return "1024x1024"

    def _resize_image_base64(self, image_base64: str, target_size: str) -> str:
        target_width, target_height = parse_image_size(target_size)
        image_data = base64.b64decode(image_base64)
        with Image.open(BytesIO(image_data)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            if image.size == (target_width, target_height):
                return image_base64

            resized = ImageOps.fit(
                image,
                (target_width, target_height),
                method=Image.Resampling.LANCZOS,
                centering=(0.5, 0.5),
            )
            output = BytesIO()
            resized.save(output, format="PNG", optimize=True)
        return base64.b64encode(output.getvalue()).decode("ascii")

    def generate_image(self, payload: ImageRequest) -> dict[str, Any]:
        style_direction = STYLE_PROMPTS.get(payload.style, STYLE_PROMPTS["\u5199\u5b9e"])
        final_prompt = (
            f"{payload.prompt}\n"
            f"Style direction: {style_direction}\n"
            f"Target composition: {payload.size} pixels, aspect ratio {payload.aspect_ratio}."
        )
        try:
            if self.provider == "grok":
                result = self.client.images.generate(
                    model=self.image_model,
                    prompt=final_prompt,
                    n=1,
                    extra_body={
                        "aspect_ratio": payload.aspect_ratio,
                        "resolution": payload.quality,
                    },
                )
            else:
                api_size = self._openai_generation_size(payload.size)
                result = self.client.images.generate(
                    model=self.image_model,
                    prompt=final_prompt,
                    size=api_size,
                    n=1,
                )

            image_base64 = self._extract_image_base64(result)
            if not image_base64:
                raise OpenAIServiceError("OpenAI returned an empty image")
            if self.provider == "openai":
                image_base64 = self._resize_image_base64(image_base64, payload.size)

            usage = extract_usage_dict(result)
            if usage["total_tokens"] <= 0:
                prompt_tokens = estimate_text_tokens(final_prompt)
                completion_tokens = max(1000, prompt_tokens)
                usage = {
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": prompt_tokens + completion_tokens,
                }

            return {
                "image_base64": image_base64,
                "model": self.image_model,
                "prompt_tokens": usage["prompt_tokens"],
                "completion_tokens": usage["completion_tokens"],
                "total_tokens": usage["total_tokens"],
            }
        except OpenAIError as exc:
            raise OpenAIServiceError(str(exc)) from exc
        except httpx.HTTPError as exc:
            raise OpenAIServiceError(f"Image download failed: {exc}") from exc


def parse_image_size(size: str) -> tuple[int, int]:
    try:
        width_text, height_text = size.lower().split("x", 1)
        width = int(width_text)
        height = int(height_text)
    except (ValueError, AttributeError) as exc:
        raise OpenAIServiceError(f"Invalid image size: {size}") from exc

    if width <= 0 or height <= 0:
        raise OpenAIServiceError(f"Invalid image size: {size}")
    return width, height
