import { ApiError, clearAuthSession, getAuthToken, getStoredUser, type Provider } from "@/lib/api";

export type WorkflowExecutionMode = "sequential" | "parallel";
export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "paused"
  | "waiting_approval"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";
export type WorkflowNodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type WorkflowScheduleType = "once" | "daily" | "weekly";

export interface WorkflowRunNode {
  id: number;
  node_key: string;
  node_type: string;
  name: string;
  instruction: string;
  sort_order: number;
  status: WorkflowNodeStatus;
  input_text: string | null;
  output_text: string | null;
  error: string | null;
  attempt: number;
  duration_ms: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface WorkflowRun {
  id: number;
  workflow_id: string;
  target: "chat" | "image";
  name: string;
  prompt: string;
  provider: Provider;
  model: string | null;
  execution_mode: WorkflowExecutionMode;
  approval_required: boolean;
  quality_gate: boolean;
  status: WorkflowRunStatus;
  current_node_index: number;
  final_output: string | null;
  quality_status: string | null;
  quality_feedback: string | null;
  error: string | null;
  image_record_id: number | null;
  image_base64: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  paused_at: string | null;
  approved_at: string | null;
  completed_at: string | null;
  nodes: WorkflowRunNode[];
}

export type WorkflowRunSummary = Omit<WorkflowRun, "nodes" | "image_base64">;

export interface WorkflowStepInput {
  id?: string;
  title: string;
  description: string;
}

export interface WorkflowRunInput {
  workflow_id: string;
  target: "chat" | "image";
  name: string;
  prompt: string;
  steps: WorkflowStepInput[];
  provider: Provider;
  model?: string | null;
  execution_mode: WorkflowExecutionMode;
  approval_required: boolean;
  quality_gate: boolean;
}

export interface WorkflowSchedule extends WorkflowRunInput {
  id: number;
  schedule_type: WorkflowScheduleType;
  next_run_at: string | null;
  enabled: boolean;
  last_run_at: string | null;
  last_run_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowScheduleInput extends WorkflowRunInput {
  schedule_type: WorkflowScheduleType;
  next_run_at: string;
  enabled: boolean;
}

export interface WorkflowRuntimeHandoff {
  version: 1;
  workflowId: string;
  name: string;
  prompt: string;
  steps: WorkflowStepInput[];
  target: "chat" | "image";
  accent: string;
  createdAt: string;
  ownerId?: number | null;
}

export const WORKFLOW_RUNTIME_HANDOFF_KEY = "aiweb:workflow-runtime-handoff";

const API_BASE_URL = "";

async function runtimeRequest<T>(path: string, init?: RequestInit): Promise<T> {
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
    const detail = payload?.detail;
    const message = Array.isArray(detail)
      ? detail.map((item: { msg?: string }) => item.msg ?? "请求参数错误").join("；")
      : typeof detail === "string"
        ? detail
        : await response.text().catch(() => "");
    if (response.status === 401) clearAuthSession();
    throw new ApiError(message || "执行引擎暂时不可用，请稍后重试。", response.status);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function createWorkflowRun(payload: WorkflowRunInput) {
  return runtimeRequest<WorkflowRun>("/api/workflows/runs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getWorkflowRuns() {
  return runtimeRequest<WorkflowRunSummary[]>("/api/workflows/runs").then((runs) =>
    runs.map((run) => ({ ...run, image_base64: null, nodes: [] }))
  );
}

export function getWorkflowRun(runId: number) {
  return runtimeRequest<WorkflowRun>(`/api/workflows/runs/${runId}`);
}

export function pauseWorkflowRun(runId: number) {
  return runtimeRequest<WorkflowRun>(`/api/workflows/runs/${runId}/pause`, { method: "POST" });
}

export function resumeWorkflowRun(runId: number) {
  return runtimeRequest<WorkflowRun>(`/api/workflows/runs/${runId}/resume`, { method: "POST" });
}

export function approveWorkflowRun(runId: number) {
  return runtimeRequest<WorkflowRun>(`/api/workflows/runs/${runId}/approve`, { method: "POST" });
}

export function retryWorkflowRun(runId: number, nodeKey?: string) {
  return runtimeRequest<WorkflowRun>(`/api/workflows/runs/${runId}/retry`, {
    method: "POST",
    body: JSON.stringify(nodeKey ? { node_key: nodeKey } : {})
  });
}

export function createWorkflowSchedule(payload: WorkflowScheduleInput) {
  return runtimeRequest<WorkflowSchedule>("/api/workflows/schedules", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getWorkflowSchedules() {
  return runtimeRequest<WorkflowSchedule[]>("/api/workflows/schedules");
}

export function updateWorkflowSchedule(scheduleId: number, payload: Partial<WorkflowScheduleInput>) {
  return runtimeRequest<WorkflowSchedule>(`/api/workflows/schedules/${scheduleId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function toggleWorkflowSchedule(scheduleId: number, enabled: boolean) {
  return runtimeRequest<WorkflowSchedule>(`/api/workflows/schedules/${scheduleId}/enabled`, {
    method: "PATCH",
    body: JSON.stringify({ enabled })
  });
}

export function deleteWorkflowSchedule(scheduleId: number) {
  return runtimeRequest<void>(`/api/workflows/schedules/${scheduleId}`, { method: "DELETE" });
}

export function runWorkflowScheduleNow(scheduleId: number) {
  return runtimeRequest<WorkflowRun>(`/api/workflows/schedules/${scheduleId}/run-now`, { method: "POST" });
}

export function saveWorkflowRuntimeHandoff(handoff: WorkflowRuntimeHandoff) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    WORKFLOW_RUNTIME_HANDOFF_KEY,
    JSON.stringify({ ...handoff, ownerId: getStoredUser()?.id ?? null })
  );
}

export function consumeWorkflowRuntimeHandoff(workflowId?: string | null): WorkflowRuntimeHandoff | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(WORKFLOW_RUNTIME_HANDOFF_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WorkflowRuntimeHandoff>;
    if (
      parsed.version !== 1 ||
      typeof parsed.workflowId !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.prompt !== "string" ||
      !Array.isArray(parsed.steps)
    ) {
      return null;
    }
    if ((parsed.ownerId ?? null) !== (getStoredUser()?.id ?? null)) {
      window.sessionStorage.removeItem(WORKFLOW_RUNTIME_HANDOFF_KEY);
      return null;
    }
    if (workflowId && parsed.workflowId !== workflowId) return null;
    window.sessionStorage.removeItem(WORKFLOW_RUNTIME_HANDOFF_KEY);
    return parsed as WorkflowRuntimeHandoff;
  } catch {
    window.sessionStorage.removeItem(WORKFLOW_RUNTIME_HANDOFF_KEY);
    return null;
  }
}
