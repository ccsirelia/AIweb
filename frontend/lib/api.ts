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
  provider: Provider;
  model: string;
  created_at: string;
  started_at?: string | null;
  completed_at: string | null;
};

export type ImageRecord = {
  id: number;
  prompt: string;
  style: string;
  size: string;
  mode: "text_to_image" | "image_to_image";
  reference_count: number;
  image_base64: string;
  created_at: string;
};

export type Provider = "openai" | "grok";

export type ChatModel = {
  id: number;
  provider: Provider;
  model_id: string;
  display_name: string;
  is_default: boolean;
};

export type ArenaContestant = {
  provider: Provider;
  model?: string | null;
  role?: string;
};

export type ArenaTokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type ArenaResult = {
  contestant_index: number;
  text: string;
  model: string;
  provider: Provider;
  latency_ms: number;
  tokens: ArenaTokenUsage;
  error: string | null;
};

export type ImageJob = {
  id: number;
  status: "pending" | "running" | "completed" | "failed";
  error: string;
  prompt: string;
  style: string;
  size: string;
  provider: Provider;
  mode: "text_to_image" | "image_to_image";
  reference_count: number;
  image_record_id: number | null;
  image_base64: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
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

export type HealthStatus = {
  status: string;
};

export type ChatStreamMeta = {
  session_id: number;
  provider: Provider;
  model: string;
};

export type ChatStreamUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type ChatStreamDone = {
  session_id: number;
  message_id: number;
  model: string;
  usage: ChatStreamUsage;
};

export type ChatStreamOptions = {
  message: string;
  sessionId?: number | null;
  provider?: Provider;
  model?: string;
  signal?: AbortSignal;
  onSessionId?: (sessionId: number) => void;
  onMeta?: (meta: ChatStreamMeta) => void;
  onDelta?: (text: string) => void;
  onDone?: (result: ChatStreamDone) => void;
};

export const AUTH_CHANGED_EVENT = "aiweb-auth-changed";
export const AUTH_WILL_CHANGE_EVENT = "aiweb-auth-will-change";
const PENDING_PROMPT_STORAGE_KEY = "aiweb:pending-prompt";
const PENDING_ARTIFACT_STORAGE_KEY = "aiweb:pending-artifact";
const PENDING_WORKFLOW_RUNTIME_KEY = "aiweb:workflow-runtime-handoff";

function clearPendingCrossPageData() {
  sessionStorage.removeItem(PENDING_PROMPT_STORAGE_KEY);
  sessionStorage.removeItem(PENDING_ARTIFACT_STORAGE_KEY);
  sessionStorage.removeItem(PENDING_WORKFLOW_RUNTIME_KEY);
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

// Browser requests stay same-origin; Next.js resolves the private backend.
const API_BASE_URL = "";

export function getAuthToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("aiweb_token") ?? "";
}

export function setAuthSession(payload: AuthResponse) {
  const previousUser = getStoredUser();
  window.dispatchEvent(new Event(AUTH_WILL_CHANGE_EVENT));
  if (previousUser && previousUser.id !== payload.user.id) {
    clearPendingCrossPageData();
  }
  localStorage.setItem("aiweb_token", payload.token);
  localStorage.setItem("aiweb_user", JSON.stringify(payload.user));
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function clearAuthSession() {
  window.dispatchEvent(new Event(AUTH_WILL_CHANGE_EVENT));
  localStorage.removeItem("aiweb_token");
  localStorage.removeItem("aiweb_user");
  clearPendingCrossPageData();
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
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
      if (response.status === 401) clearAuthSession();
      throw new ApiError(detail, response.status);
    }

    const text = await response.text().catch(() => "");
    if (response.status === 401) clearAuthSession();
    throw new ApiError(text || "请求失败，请稍后重试。", response.status);
  }

  return response.json() as Promise<T>;
}

async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const payload = await response.clone().json().catch(() => null);
    if (payload?.detail) {
      if (response.status === 401) clearAuthSession();
      throw new ApiError(Array.isArray(payload.detail) ? payload.detail.map((item: { msg?: string }) => item.msg ?? "Request error").join(", ") : payload.detail, response.status);
    }
    const text = await response.text().catch(() => "");
    if (response.status === 401) clearAuthSession();
    throw new ApiError(text || "Request failed, please try again later.", response.status);
  }

  return response.blob();
}

export async function downloadChatAnswerWord(content: string) {
  const blob = await requestBlob("/api/chat/export-word", {
    method: "POST",
    body: JSON.stringify({ content })
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `aiweb-answer-${Date.now()}.docx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

export function changePassword(payload: { current_password: string; new_password: string }) {
  return request<AuthResponse>("/api/account/password", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function sendChat(message: string, sessionId?: number | null, provider: Provider = "openai", model?: string) {
  return request<{ text: string; session_id: number }>("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message, session_id: sessionId ?? null, provider, model: model || null })
  });
}

export async function streamChat({
  message,
  sessionId,
  provider = "openai",
  model,
  signal,
  onSessionId,
  onMeta,
  onDelta,
  onDone
}: ChatStreamOptions): Promise<ChatStreamDone> {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE_URL}/api/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ message, session_id: sessionId ?? null, provider, model: model || null }),
    cache: "no-store",
    signal
  });

  if (!response.ok) {
    const payload = await response.clone().json().catch(() => null);
    const detail = payload?.detail;
    const messageText = detail
      ? Array.isArray(detail)
        ? detail.map((item: { msg?: string }) => item.msg ?? "请求参数错误").join("；")
        : String(detail)
      : await response.text().catch(() => "");
    if (response.status === 401) clearAuthSession();
    throw new ApiError(messageText || "无法建立流式连接，请稍后重试。", response.status);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new ApiError("浏览器未能建立流式连接。", 502);

  let announcedSessionId: number | null = null;
  const announceSession = (value: unknown) => {
    const nextSessionId = Number(value);
    if (!Number.isSafeInteger(nextSessionId) || nextSessionId <= 0 || nextSessionId === announcedSessionId) return;
    announcedSessionId = nextSessionId;
    onSessionId?.(nextSessionId);
  };
  announceSession(response.headers.get("X-Session-Id"));

  const decoder = new TextDecoder();
  let buffer = "";
  let completed: ChatStreamDone | null = null;

  const processEvent = (block: string) => {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (dataLines.length === 0) return;

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
    } catch {
      throw new ApiError("收到无法解析的流式响应。", 502);
    }

    if (eventName === "meta") {
      const meta: ChatStreamMeta = {
        session_id: Number(payload.session_id),
        provider: payload.provider === "grok" ? "grok" : "openai",
        model: String(payload.model ?? "")
      };
      announceSession(meta.session_id);
      onMeta?.(meta);
      return;
    }

    if (eventName === "delta") {
      if (typeof payload.text === "string" && payload.text) onDelta?.(payload.text);
      return;
    }

    if (eventName === "done") {
      const rawUsage = (payload.usage ?? {}) as Partial<ChatStreamUsage>;
      completed = {
        session_id: Number(payload.session_id),
        message_id: Number(payload.message_id),
        model: String(payload.model ?? ""),
        usage: {
          prompt_tokens: Number(rawUsage.prompt_tokens ?? 0),
          completion_tokens: Number(rawUsage.completion_tokens ?? 0),
          total_tokens: Number(rawUsage.total_tokens ?? 0)
        }
      };
      announceSession(completed.session_id);
      onDone?.(completed);
      return;
    }

    if (eventName === "error") {
      throw new ApiError(String(payload.message || "AI 回复失败，请稍后重试。"), 502);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (block.trim()) processEvent(block);
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
    if (buffer.trim()) processEvent(buffer);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (!completed) throw new ApiError("流式连接提前结束，请重试。", 502);
  return completed;
}

export function createChatJob(message: string, sessionId?: number | null, files?: File[], provider: Provider = "openai", model?: string) {
  if (files?.length) {
    const form = new FormData();
    form.append("message", message || "请分析这些附件。");
    form.append("provider", provider);
    if (model) form.append("model", model);
    if (sessionId != null) form.append("session_id", String(sessionId));
    // Use the same field name the backend expects; include filename for proxies.
    files.forEach((file) => form.append("files", file, file.name));
    return request<ChatJob>("/api/chat/jobs", {
      method: "POST",
      body: form
    });
  }

  return request<ChatJob>("/api/chat/jobs", {
    method: "POST",
    body: JSON.stringify({ message, session_id: sessionId ?? null, provider, model: model || null })
  });
}

export function getChatJob(jobId: number) {
  return request<ChatJob>(`/api/chat/jobs/${jobId}`);
}

export function getChatSessions() {
  return request<ChatSession[]>("/api/chat/sessions");
}

export function getChatModels() {
  return request<ChatModel[]>("/api/chat/models");
}

export function compareArena(prompt: string, contestants: ArenaContestant[]) {
  return request<{ results: ArenaResult[] }>("/api/arena/compare", {
    method: "POST",
    body: JSON.stringify({ prompt, contestants })
  });
}

export function getChatSession(sessionId: number) {
  return request<{ session: ChatSession; messages: ChatMessage[] }>(`/api/chat/sessions/${sessionId}`);
}

export function updateChatSession(sessionId: number, title: string) {
  return request<ChatSession>(`/api/chat/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ title })
  });
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

export function createImageJob(payload: {
  prompt: string;
  style: string;
  size: string;
  aspect_ratio?: string;
  quality?: string;
  provider?: Provider;
  mode?: "text_to_image" | "image_to_image";
  reference_images?: File[];
}) {
  if (payload.reference_images?.length) {
    const form = new FormData();
    form.append("prompt", payload.prompt);
    form.append("style", payload.style);
    form.append("size", payload.size);
    form.append("aspect_ratio", payload.aspect_ratio ?? "1:1");
    form.append("quality", payload.quality ?? "1k");
    form.append("provider", payload.provider ?? "openai");
    form.append("mode", payload.mode ?? "image_to_image");
    payload.reference_images.forEach((file) => form.append("reference_images", file, file.name));
    return request<ImageJob>("/api/image/jobs", {
      method: "POST",
      body: form
    });
  }
  return request<ImageJob>("/api/image/jobs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getImageJob(jobId: number) {
  return request<ImageJob>(`/api/image/jobs/${jobId}`);
}

export function getHistory() {
  return request<{ chats: ChatRecord[]; images: ImageRecord[] }>("/api/history");
}

export function getRecentImages() {
  return request<ImageRecord[]>("/api/images");
}

export function deleteImage(recordId: number) {
  return request<{ status: string }>(`/api/images/${recordId}`, { method: "DELETE" });
}

export function getHealth() {
  return request<HealthStatus>("/api/health");
}
