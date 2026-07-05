export type ChatRecord = {
  id: number;
  user_message: string;
  ai_response: string;
  created_at: string;
};

export type ImageRecord = {
  id: number;
  prompt: string;
  style: string;
  size: string;
  image_base64: string;
  created_at: string;
};

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const payload = await response.clone().json().catch(() => null);
    if (payload?.detail) {
      const detail = Array.isArray(payload.detail) ? payload.detail.map((item: { msg?: string }) => item.msg).join("；") : payload.detail;
      throw new Error(detail);
    }

    const text = await response.text().catch(() => "");
    throw new Error(text || "请求失败，请稍后重试。");
  }

  return response.json() as Promise<T>;
}

export function sendChat(message: string) {
  return request<{ text: string }>("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message })
  });
}

export function generateImage(payload: { prompt: string; style: string; size: string }) {
  return request<{ image_base64: string }>("/api/image", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getHistory() {
  return request<{ chats: ChatRecord[]; images: ImageRecord[] }>("/api/history");
}
