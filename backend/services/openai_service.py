import base64
from io import BytesIO
from typing import Any

import httpx
from dotenv import load_dotenv
from openai import OpenAI, OpenAIError
from PIL import Image, ImageOps

from models.schemas import ImageRequest
from services.settings_service import get_model_config, get_runtime_config, normalize_provider
from services.token_usage_service import estimate_text_tokens, extract_usage_dict

load_dotenv()


class OpenAIServiceError(RuntimeError):
    pass


SYSTEM_PROMPT = """You are a professional AI creation assistant. Answer clearly, accurately, and with structured Markdown.

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

    def _chat_completion_messages(
        self,
        message: str,
        history: list[dict[str, str]] | None,
        attachments: list[dict[str, str | int | None]] | None,
    ) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
        messages.extend(history or [])

        if attachments:
            content_parts: list[dict[str, Any]] = [{"type": "text", "text": message}]
            text_blocks: list[str] = []
            for item in attachments:
                filename = str(item.get("filename") or "attachment")
                content_type = str(item.get("content_type") or "application/octet-stream")
                text_content = item.get("text_content")
                data_url = item.get("data_url")
                if isinstance(data_url, str) and data_url:
                    content_parts.append({"type": "image_url", "image_url": {"url": data_url}})
                elif isinstance(text_content, str) and text_content:
                    text_blocks.append(f"File: {filename}\n{text_content}")
                else:
                    text_blocks.append(f"Uploaded file: {filename} ({content_type}). Use this as attachment metadata.")
            if text_blocks:
                content_parts.append({"type": "text", "text": "\n\n".join(text_blocks)})
            messages.append({"role": "user", "content": content_parts})
        else:
            messages.append({"role": "user", "content": message})
        return messages

    def _responses_input_messages(
        self,
        message: str,
        history: list[dict[str, str]] | None,
        attachments: list[dict[str, str | int | None]] | None,
    ) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
        messages.extend(history or [])

        if attachments:
            content_parts: list[dict[str, str]] = [{"type": "input_text", "text": message}]
            text_blocks: list[str] = []
            for item in attachments:
                filename = str(item.get("filename") or "attachment")
                content_type = str(item.get("content_type") or "application/octet-stream")
                text_content = item.get("text_content")
                data_url = item.get("data_url")
                if isinstance(data_url, str) and data_url:
                    content_parts.append({"type": "input_image", "image_url": data_url})
                elif isinstance(text_content, str) and text_content:
                    text_blocks.append(f"File: {filename}\n{text_content}")
                else:
                    text_blocks.append(f"Uploaded file: {filename} ({content_type}). Use this as attachment metadata.")
            if text_blocks:
                content_parts.append({"type": "input_text", "text": "\n\n".join(text_blocks)})
            messages.append({"role": "user", "content": content_parts})
        else:
            messages.append({"role": "user", "content": message})
        return messages

    def _fallback_prompt_text(
        self,
        message: str,
        history: list[dict[str, str]] | None,
        attachments: list[dict[str, str | int | None]] | None,
    ) -> str:
        parts = [SYSTEM_PROMPT]
        for item in history or []:
            parts.append(str(item.get("content") or ""))
        parts.append(message)
        for item in attachments or []:
            text_content = item.get("text_content")
            if isinstance(text_content, str) and text_content:
                parts.append(text_content)
            else:
                parts.append(str(item.get("filename") or "attachment"))
        return "\n".join(parts)

    def _chat_with_completions(
        self,
        message: str,
        history: list[dict[str, str]] | None = None,
        attachments: list[dict[str, str | int | None]] | None = None,
    ) -> dict[str, Any]:
        response = self.client.chat.completions.create(
            model=self.text_model,
            messages=self._chat_completion_messages(message, history, attachments),
        )
        choice = response.choices[0] if response.choices else None
        text = choice.message.content if choice and choice.message else None
        if isinstance(text, str) and text.strip():
            return self._result_payload(
                text.strip(),
                response,
                fallback_text=self._fallback_prompt_text(message, history, attachments),
            )
        raise OpenAIServiceError("OpenAI returned an empty response")

    def chat(
        self,
        message: str,
        history: list[dict[str, str]] | None = None,
        attachments: list[dict[str, str | int | None]] | None = None,
    ) -> dict[str, Any]:
        fallback_text = self._fallback_prompt_text(message, history, attachments)
        try:
            response = self.client.responses.create(
                model=self.text_model,
                input=self._responses_input_messages(message, history, attachments),
            )
            text = self._extract_responses_text(response)
            if text:
                return self._result_payload(text, response, fallback_text=fallback_text)

            return self._chat_with_completions(message, history, attachments)
        except OpenAIError:
            try:
                return self._chat_with_completions(message, history, attachments)
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
            if self.provider == "gork":
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
