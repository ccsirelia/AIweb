from dotenv import load_dotenv
from openai import OpenAI, OpenAIError

from models.schemas import ImageRequest
from services.settings_service import get_openai_model_config, get_openai_runtime_config

load_dotenv()


class OpenAIServiceError(RuntimeError):
    pass


class OpenAIService:
    def __init__(self) -> None:
        base_url, api_key = get_openai_runtime_config()
        if not api_key:
            raise OpenAIServiceError("OPENAI_API_KEY is not configured")
        self.client = OpenAI(api_key=api_key, base_url=base_url)
        self.text_model, self.image_model = get_openai_model_config()

    def chat(
        self,
        message: str,
        history: list[dict[str, str]] | None = None,
        attachments: list[dict[str, str | int | None]] | None = None,
    ) -> str:
        try:
            input_messages: list[dict] = [
                {
                    "role": "system",
                    "content": "你是一个专业、清晰、可靠的 AI 创作助手。回答要有结构、准确，并保持简洁。",
                }
            ]
            input_messages.extend(history or [])

            user_content: str | list[dict[str, str]]
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
                        text_blocks.append(f"文件：{filename}\n{text_content}")
                    else:
                        text_blocks.append(f"已上传文件：{filename}（{content_type}），当前仅作为文件信息提供。")

                if text_blocks:
                    content_parts.append({"type": "input_text", "text": "\n\n".join(text_blocks)})
                user_content = content_parts
            else:
                user_content = message

            input_messages.append({"role": "user", "content": user_content})
            response = self.client.responses.create(
                model=self.text_model,
                input=input_messages,
            )
            text = getattr(response, "output_text", None)
            if not text:
                raise OpenAIServiceError("OpenAI returned an empty response")
            return text
        except OpenAIError as exc:
            raise OpenAIServiceError(str(exc)) from exc

    def generate_image(self, payload: ImageRequest) -> str:
        style_prompts = {
            "写实": "photorealistic, premium commercial visual, realistic lighting",
            "动漫": "anime style, crisp line art, expressive color, polished composition",
            "3D": "high-end 3D render, cinematic lighting, detailed materials",
            "油画": "oil painting, layered brush texture, gallery-quality composition",
            "产品图": "premium product photography, clean studio background, soft shadows",
            "摄影": "professional photography, editorial lighting, refined details",
        }
        final_prompt = f"{payload.prompt}\nStyle direction: {style_prompts[payload.style]}"
        try:
            result = self.client.images.generate(
                model=self.image_model,
                prompt=final_prompt,
                size=payload.size,
                n=1,
            )
            image_base64 = result.data[0].b64_json
            if not image_base64:
                raise OpenAIServiceError("OpenAI returned an empty image")
            return image_base64
        except OpenAIError as exc:
            raise OpenAIServiceError(str(exc)) from exc
