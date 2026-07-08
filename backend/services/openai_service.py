import base64
from typing import Any

import httpx
from dotenv import load_dotenv
from openai import OpenAI, OpenAIError

from models.schemas import ImageRequest
from services.settings_service import get_model_config, get_runtime_config, normalize_provider

load_dotenv()


class OpenAIServiceError(RuntimeError):
    pass


SYSTEM_PROMPT = """你是一个专业、清晰、可靠的 AI 创作助手。回答要有结构、准确，并保持简洁。

为了给前端展示类似 ChatGPT 的“思考”体验，你必须按下面格式返回：

<ai_thought_summary>
用公开可展示的高层分析说明你的处理过程，不要展示隐含推理链、逐字内心推理或私密 chain-of-thought。
建议包含 3-6 条简洁要点，可按需要覆盖：
- 理解问题：用户真正想解决什么
- 关键依据：你抓住了哪些约束、条件或线索
- 处理策略：你会采用什么路径组织答案
- 注意事项：有哪些边界、风险或容易误解的点
- 结论方向：最终答案将围绕什么展开
</ai_thought_summary>

<ai_answer>
这里输出正式答案。请使用清晰 Markdown 排版：
- 多用标题、列表、表格和代码块
- 数学公式必须使用 LaTeX 分隔符：行内公式写成 $a^2+b^2=c^2$，独立公式写成 $$...$$
- 不要用普通方括号表示公式，例如不要写 [ e^{ix}=\\cos x+i\\sin x ]，要写成 $$e^{ix}=\\cos x+i\\sin x$$
- 不要把 <ai_thought_summary> 或 <ai_answer> 标签放进代码块
</ai_answer>

如果问题非常简单，思考说明可以只保留 1-2 条。"""


STYLE_PROMPTS = {
    "写实": "photorealistic, premium commercial visual, realistic lighting",
    "动漫": "anime style, crisp line art, expressive color, polished composition",
    "3D": "high-end 3D render, cinematic lighting, detailed materials",
    "油画": "oil painting, layered brush texture, gallery-quality composition",
    "产品图": "premium product photography, clean studio background, soft shadows",
    "摄影": "professional photography, editorial lighting, refined details",
}


class OpenAIService:
    def __init__(self, provider: str = "openai") -> None:
        self.provider = normalize_provider(provider)
        base_url, api_key = get_runtime_config(self.provider)
        if not api_key:
            raise OpenAIServiceError(f"{self.provider.upper()} API key is not configured")
        self.client = OpenAI(api_key=api_key, base_url=base_url)
        self.text_model, self.image_model = get_model_config(self.provider)

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
                    text_blocks.append(f"文件：{filename}\n{text_content}")
                else:
                    text_blocks.append(f"已上传文件：{filename}（{content_type}），当前仅作为文件信息提供。")
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
                    text_blocks.append(f"文件：{filename}\n{text_content}")
                else:
                    text_blocks.append(f"已上传文件：{filename}（{content_type}），当前仅作为文件信息提供。")
            if text_blocks:
                content_parts.append({"type": "input_text", "text": "\n\n".join(text_blocks)})
            messages.append({"role": "user", "content": content_parts})
        else:
            messages.append({"role": "user", "content": message})
        return messages

    def _chat_with_completions(
        self,
        message: str,
        history: list[dict[str, str]] | None = None,
        attachments: list[dict[str, str | int | None]] | None = None,
    ) -> str:
        response = self.client.chat.completions.create(
            model=self.text_model,
            messages=self._chat_completion_messages(message, history, attachments),
        )
        choice = response.choices[0] if response.choices else None
        text = choice.message.content if choice and choice.message else None
        if isinstance(text, str) and text.strip():
            return text.strip()
        raise OpenAIServiceError("OpenAI returned an empty response")

    def chat(
        self,
        message: str,
        history: list[dict[str, str]] | None = None,
        attachments: list[dict[str, str | int | None]] | None = None,
    ) -> str:
        try:
            response = self.client.responses.create(
                model=self.text_model,
                input=self._responses_input_messages(message, history, attachments),
            )
            text = self._extract_responses_text(response)
            if text:
                return text

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

    def generate_image(self, payload: ImageRequest) -> str:
        style_direction = STYLE_PROMPTS.get(payload.style, STYLE_PROMPTS["写实"])
        final_prompt = f"{payload.prompt}\nStyle direction: {style_direction}"
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
                result = self.client.images.generate(
                    model=self.image_model,
                    prompt=final_prompt,
                    size=payload.size,
                    n=1,
                )

            image_base64 = self._extract_image_base64(result)
            if not image_base64:
                raise OpenAIServiceError("OpenAI returned an empty image")
            return image_base64
        except OpenAIError as exc:
            raise OpenAIServiceError(str(exc)) from exc
        except httpx.HTTPError as exc:
            raise OpenAIServiceError(f"Image download failed: {exc}") from exc
