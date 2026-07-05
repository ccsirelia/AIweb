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

    def chat(self, message: str, history: list[dict[str, str]] | None = None) -> str:
        try:
            input_messages = [
                {
                    "role": "system",
                    "content": "你是一个专业、清晰、可靠的 AI 创作助手。回答要有结构、准确，并保持简洁。",
                }
            ]
            input_messages.extend(history or [])
            input_messages.append({"role": "user", "content": message})
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
