export type ChatRecord = {
  id: number;
  user_message: string;
  ai_response: string;
  created_at: string;
};

export type ChatMessage = {
  id: number;
  session_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type ChatSession = {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
};

export type ChatJob = {
  id: number;
  session_id: number;
  status: "pending" | "running" | "completed" | "failed";
  error: string;
  created_at: string;
  completed_at: string | null;
};

export type ImageRecord = {
  id: number;
  prompt: string;
  style: string;
  size: string;
  image_base64: string;
  created_at: string;
};

export type User = {
  id: number;
  username: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
};

export type AuthResponse = {
  token: string;
  user: User;
};

export type TokenUsageSummary = {
  total_tokens: number;
  last_7_days_tokens: number;
  last_24_hours_tokens: number;
};

export type AccountProfile = {
  user: User;
  created_at: string;
  token_usage: TokenUsageSummary;
  recent_images: ImageRecord[];
};

export type Provider = "openai" | "gork";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8008").replace(/\/$/, "");

export function getAuthToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("aiweb_token") ?? "";
}

export function setAuthSession(payload: AuthResponse) {
  localStorage.setItem("aiweb_token", payload.token);
  localStorage.setItem("aiweb_user", JSON.stringify(payload.user));
}

export function clearAuthSession() {
  localStorage.removeItem("aiweb_token");
  localStorage.removeItem("aiweb_user");
}

export function getStoredUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("aiweb_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const payload = await response.clone().json().catch(() => null);
    if (payload?.detail) {
      const detail = Array.isArray(payload.detail)
        ? payload.detail.map((item: { msg?: string }) => item.msg ?? "请求参数错误").join("；")
        : payload.detail;
      throw new Error(detail);
    }

    const text = await response.text().catch(() => "");
    throw new Error(text || "请求失败，请稍后重试。");
  }

  return response.json() as Promise<T>;
}

export function login(payload: { account: string; password: string }) {
  return request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function register(payload: { username: string; name: string; email: string; password: string }) {
  return request<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getMe() {
  return request<User>("/api/auth/me");
}

export function getAccountProfile() {
  return request<AccountProfile>("/api/account/profile");
}

export function sendChat(message: string, sessionId?: number | null, provider: Provider = "openai") {
  return request<{ text: string; session_id: number }>("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message, session_id: sessionId ?? null, provider })
  });
}

export function createChatJob(message: string, sessionId?: number | null, files?: File[], provider: Provider = "openai") {
  if (files?.length) {
    const form = new FormData();
    form.append("message", message);
    form.append("provider", provider);
    if (sessionId) form.append("session_id", String(sessionId));
    files.forEach((file) => form.append("files", file));
    return request<ChatJob>("/api/chat/jobs", {
      method: "POST",
      body: form
    });
  }

  return request<ChatJob>("/api/chat/jobs", {
    method: "POST",
    body: JSON.stringify({ message, session_id: sessionId ?? null, provider })
  });
}

export function getChatJob(jobId: number) {
  return request<ChatJob>(`/api/chat/jobs/${jobId}`);
}

export function getChatSessions() {
  return request<ChatSession[]>("/api/chat/sessions");
}

export function getChatSession(sessionId: number) {
  return request<{ session: ChatSession; messages: ChatMessage[] }>(`/api/chat/sessions/${sessionId}`);
}

export function deleteChatSession(sessionId: number) {
  return request<{ status: string }>(`/api/chat/sessions/${sessionId}`, {
    method: "DELETE"
  });
}

export function generateImage(payload: { prompt: string; style: string; size: string; aspect_ratio?: string; quality?: string; provider?: Provider }) {
  return request<{ image_base64: string }>("/api/image", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getHistory() {
  return request<{ chats: ChatRecord[]; images: ImageRecord[] }>("/api/history");
}

export function getRecentImages() {
  return request<ImageRecord[]>("/api/images");
}
