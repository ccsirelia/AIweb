import { ApiError, clearAuthSession, getAuthToken } from "@/lib/api";
import type { WorkflowTemplate } from "@/lib/workflows";

export interface TeamTemplateComment {
  id: string;
  userId: number;
  name: string;
  username: string;
  body: string;
  createdAt: string;
}

export interface TeamTemplate {
  id: string;
  sourceWorkflowId: string;
  workflow: WorkflowTemplate;
  owner: { id: number; name: string; username: string };
  releaseNotes: string;
  publishedAt: string;
  updatedAt: string;
  installCount: number;
  ratingAverage: number;
  ratingCount: number;
  myRating: number | null;
  comments: TeamTemplateComment[];
}

async function hubRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });
  if (!response.ok) {
    const payload = await response.clone().json().catch(() => null) as { detail?: unknown } | null;
    if (response.status === 401) clearAuthSession();
    const detail = payload?.detail;
    const message = typeof detail === "string"
      ? detail
      : Array.isArray(detail)
        ? detail.map((item) => typeof item === "object" && item && "msg" in item ? String(item.msg) : "参数错误").join("；")
        : "团队模板请求失败。";
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export async function listTeamTemplates(options: {
  query?: string;
  target?: "all" | "chat" | "image";
  sort?: "recent" | "rating" | "popular";
} = {}): Promise<TeamTemplate[]> {
  const params = new URLSearchParams({
    query: options.query ?? "",
    target: options.target ?? "all",
    sort: options.sort ?? "recent"
  });
  const result = await hubRequest<{ items: TeamTemplate[] }>(`/api/template-hub?${params.toString()}`);
  return result.items;
}

export function publishTeamTemplate(workflow: WorkflowTemplate, releaseNotes = ""): Promise<TeamTemplate> {
  return hubRequest<TeamTemplate>("/api/template-hub", {
    method: "POST",
    body: JSON.stringify({ workflow, releaseNotes })
  });
}

export async function commentOnTeamTemplate(templateId: string, body: string): Promise<TeamTemplate> {
  const result = await hubRequest<{ template: TeamTemplate }>(`/api/template-hub/${encodeURIComponent(templateId)}/comments`, {
    method: "POST",
    body: JSON.stringify({ body })
  });
  return result.template;
}

export async function rateTeamTemplate(templateId: string, value: number): Promise<Pick<TeamTemplate, "ratingAverage" | "ratingCount" | "myRating">> {
  return hubRequest<Pick<TeamTemplate, "ratingAverage" | "ratingCount" | "myRating">>(`/api/template-hub/${encodeURIComponent(templateId)}/rating`, {
    method: "PUT",
    body: JSON.stringify({ value })
  });
}

export function installTeamTemplate(templateId: string): Promise<TeamTemplate> {
  return hubRequest<TeamTemplate>(`/api/template-hub/${encodeURIComponent(templateId)}/install`, { method: "POST" });
}

export function deleteTeamTemplate(templateId: string): Promise<{ ok: boolean }> {
  return hubRequest<{ ok: boolean }>(`/api/template-hub/${encodeURIComponent(templateId)}`, { method: "DELETE" });
}

