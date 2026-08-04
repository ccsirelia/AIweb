"use client";

import {
  Activity,
  BadgeCheck,
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  Clock3,
  Cpu,
  Gauge,
  GitBranch,
  ImageIcon,
  ListRestart,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  Network,
  Pause,
  Play,
  Plus,
  RadioTower,
  RefreshCw,
  Rocket,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquareArrowOutUpRight,
  Trash2,
  Zap,
  type LucideIcon
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { PageShell } from "@/components/page-shell";
import { getStoredUser } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  approveWorkflowRun,
  consumeWorkflowRuntimeHandoff,
  createWorkflowRun,
  createWorkflowSchedule,
  deleteWorkflowSchedule,
  getWorkflowRun,
  getWorkflowRuns,
  getWorkflowSchedules,
  pauseWorkflowRun,
  resumeWorkflowRun,
  retryWorkflowRun,
  runWorkflowScheduleNow,
  toggleWorkflowSchedule,
  type WorkflowExecutionMode,
  type WorkflowRun,
  type WorkflowRunInput,
  type WorkflowRunNode,
  type WorkflowSchedule,
  type WorkflowScheduleType,
  type WorkflowStepInput
} from "@/lib/workflow-runtime";

type RuntimeTab = "runs" | "schedules";

interface RuntimeDraft {
  workflow_id: string;
  target: "chat" | "image";
  name: string;
  prompt: string;
  stepsText: string;
  provider: "openai" | "grok";
  execution_mode: WorkflowExecutionMode;
  approval_required: boolean;
  quality_gate: boolean;
}

const emptyDraft: RuntimeDraft = {
  workflow_id: "custom-runtime",
  target: "chat",
  name: "新建执行链路",
  prompt: "",
  stepsText: "理解任务 | 提取目标、约束与关键上下文\n执行创作 | 基于任务完成高质量初稿\n校验交付 | 检查完整性、准确性与可执行性",
  provider: "openai",
  execution_mode: "sequential",
  approval_required: false,
  quality_gate: true
};

const statusMeta: Record<string, { label: string; color: string; dot: string }> = {
  pending: { label: "等待调度", color: "text-slate-400", dot: "bg-slate-400" },
  running: { label: "执行中", color: "text-[#38BDF8]", dot: "bg-[#38BDF8]" },
  paused: { label: "已暂停", color: "text-[#FBBF24]", dot: "bg-[#FBBF24]" },
  waiting_approval: { label: "等待审批", color: "text-[#A78BFA]", dot: "bg-[#A78BFA]" },
  awaiting_approval: { label: "等待审批", color: "text-[#A78BFA]", dot: "bg-[#A78BFA]" },
  completed: { label: "已完成", color: "text-[#2DD4BF]", dot: "bg-[#2DD4BF]" },
  failed: { label: "执行失败", color: "text-[#FB7185]", dot: "bg-[#FB7185]" },
  cancelled: { label: "已取消", color: "text-slate-400", dot: "bg-slate-400" },
  skipped: { label: "已跳过", color: "text-slate-400", dot: "bg-slate-400" }
};

function getStatusMeta(status: string) {
  return statusMeta[status] ?? { label: status || "未知", color: "text-muted-foreground", dot: "bg-muted-foreground" };
}

function formatDate(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatDuration(durationMs?: number | null) {
  if (durationMs == null || durationMs <= 0) return "--";
  if (durationMs < 1000) return `${durationMs} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)} s`;
  return `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1000)}s`;
}

function toLocalDateTimeInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function parseSteps(stepsText: string): WorkflowStepInput[] {
  return stepsText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 16)
    .map((line, index) => {
      const [title, ...description] = line.split("|");
      return {
        id: `step-${index + 1}`,
        title: title.trim() || `步骤 ${index + 1}`,
        description: description.join("|").trim() || "完成当前节点任务"
      };
    });
}

function runProgress(run: WorkflowRun) {
  if (!run.nodes.length) return 0;
  const done = run.nodes.filter((node) => ["completed", "failed", "skipped"].includes(node.status)).length;
  return Math.round((done / run.nodes.length) * 100);
}

function mergeRunSnapshots(summaries: WorkflowRun[], current: WorkflowRun[], detail: WorkflowRun | null) {
  return summaries.map((summary) => {
    if (detail?.id === summary.id) return detail;
    const cached = current.find((item) => item.id === summary.id && item.nodes.length > 0);
    return cached ? { ...summary, nodes: cached.nodes } : summary;
  });
}

function qualityLabel(value: string | null, enabled: boolean) {
  if (!enabled || value === "not_requested") return "关闭";
  if (value === "pending") return "待校验";
  if (value === "passed") return "已通过";
  if (value === "retrying") return "修订中";
  if (value === "retried") return "已修订";
  return value || "待校验";
}

function RunStatus({ status, pulse = false }: { status: string; pulse?: boolean }) {
  const meta = getStatusMeta(status);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[10px] font-semibold", meta.color)}>
      <span className="relative flex h-1.5 w-1.5">
        {pulse && status === "running" ? <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:animate-none", meta.dot)} /> : null}
        <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", meta.dot)} />
      </span>
      {meta.label}
    </span>
  );
}

export function WorkflowRuntimeConsole() {
  const router = useRouter();
  const [tab, setTab] = useState<RuntimeTab>("runs");
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [schedules, setSchedules] = useState<WorkflowSchedule[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [draft, setDraft] = useState<RuntimeDraft>({ ...emptyDraft });
  const [scheduleType, setScheduleType] = useState<WorkflowScheduleType>("once");
  const [scheduleAt, setScheduleAt] = useState(() => toLocalDateTimeInput(new Date(Date.now() + 60 * 60 * 1000)));
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const selectedRunIdRef = useRef<number | null>(null);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId]
  );
  const selectedNode = useMemo(
    () => selectedRun?.nodes.find((node) => node.node_key === selectedNodeKey) ?? selectedRun?.nodes[0] ?? null,
    [selectedNodeKey, selectedRun]
  );
  const hasLiveRun = runs.some((run) => ["pending", "running"].includes(run.status));

  const refreshData = useCallback(async (quiet = false) => {
    if (!getStoredUser()) {
      setAuthenticated(false);
      setLoading(false);
      return;
    }
    if (!quiet) setRefreshing(true);
    try {
      const [nextRuns, nextSchedules] = await Promise.all([getWorkflowRuns(), getWorkflowSchedules()]);
      const preferredId = nextRuns.some((run) => run.id === selectedRunIdRef.current)
        ? selectedRunIdRef.current
        : nextRuns[0]?.id ?? null;
      const detail = preferredId ? await getWorkflowRun(preferredId).catch(() => null) : null;
      setRuns((current) => mergeRunSnapshots(nextRuns, current, detail));
      setSchedules(nextSchedules);
      setSelectedRunId(preferredId);
      setAuthenticated(true);
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message : "无法连接工作流执行引擎");
      if (!getStoredUser()) setAuthenticated(false);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const handoff = consumeWorkflowRuntimeHandoff(query.get("workflow"));
    if (handoff) {
      setDraft({
        ...emptyDraft,
        workflow_id: handoff.workflowId,
        target: handoff.target,
        name: handoff.name,
        prompt: handoff.prompt,
        stepsText: handoff.steps.map((step) => `${step.title} | ${step.description}`).join("\n")
      });
      setComposeOpen(true);
      toast.success(`已装载「${handoff.name}」`);
    }
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (authenticated !== true) return;
    const timer = window.setInterval(async () => {
      try {
        const [nextRuns, nextSchedules] = await Promise.all([getWorkflowRuns(), getWorkflowSchedules()]);
        const detailId = nextRuns.some((run) => run.id === selectedRunId) ? selectedRunId : nextRuns[0]?.id ?? null;
        const detail = detailId ? await getWorkflowRun(detailId) : null;
        setRuns((current) => mergeRunSnapshots(nextRuns, current, detail));
        setSchedules(nextSchedules);
        if (detailId !== selectedRunId) setSelectedRunId(detailId);
      } catch {
        // Keep the last stable snapshot during transient polling failures.
      }
    }, hasLiveRun ? 2000 : 5000);
    return () => window.clearInterval(timer);
  }, [authenticated, hasLiveRun, selectedRunId]);

  useEffect(() => {
    if (!selectedRun) return;
    setSelectedNodeKey((current) => selectedRun.nodes.some((node) => node.node_key === current) ? current : selectedRun.nodes[0]?.node_key ?? null);
  }, [selectedRun]);

  function buildPayload(): WorkflowRunInput | null {
    const steps = parseSteps(draft.stepsText);
    if (!draft.name.trim() || !draft.prompt.trim()) {
      toast.error("请填写任务名称和完整 Prompt");
      return null;
    }
    if (!steps.length) {
      toast.error("至少需要一个执行节点");
      return null;
    }
    return {
      workflow_id: draft.workflow_id.trim() || "custom-runtime",
      target: draft.target,
      name: draft.name.trim(),
      prompt: draft.prompt.trim(),
      steps,
      provider: draft.provider,
      execution_mode: draft.execution_mode,
      approval_required: draft.approval_required,
      quality_gate: draft.quality_gate
    };
  }

  async function submitRun() {
    const payload = buildPayload();
    if (!payload) return;
    setActionKey("create-run");
    try {
      const run = await createWorkflowRun(payload);
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setSelectedRunId(run.id);
      setComposeOpen(false);
      setTab("runs");
      toast.success("链路已进入执行队列");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建运行失败");
    } finally {
      setActionKey(null);
    }
  }

  async function submitSchedule() {
    const payload = buildPayload();
    if (!payload) return;
    const runAt = new Date(scheduleAt);
    if (Number.isNaN(runAt.getTime())) {
      toast.error("请选择有效的首次执行时间");
      return;
    }
    setActionKey("create-schedule");
    try {
      const schedule = await createWorkflowSchedule({
        ...payload,
        schedule_type: scheduleType,
        next_run_at: runAt.toISOString(),
        enabled: true
      });
      setSchedules((current) => [schedule, ...current]);
      setScheduleOpen(false);
      setComposeOpen(false);
      setTab("schedules");
      toast.success("调度计划已上线");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建调度失败");
    } finally {
      setActionKey(null);
    }
  }

  async function runAction(label: string, action: () => Promise<WorkflowRun>) {
    setActionKey(label);
    try {
      const run = await action();
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setSelectedRunId(run.id);
      toast.success("执行状态已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败，请重试");
    } finally {
      setActionKey(null);
    }
  }

  async function toggleSchedule(schedule: WorkflowSchedule) {
    setActionKey(`toggle-${schedule.id}`);
    try {
      const updated = await toggleWorkflowSchedule(schedule.id, !schedule.enabled);
      setSchedules((current) => current.map((item) => item.id === updated.id ? updated : item));
      toast.success(updated.enabled ? "调度已启用" : "调度已暂停");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新调度失败");
    } finally {
      setActionKey(null);
    }
  }

  async function removeSchedule(schedule: WorkflowSchedule) {
    if (!window.confirm(`删除调度「${schedule.name}」？`)) return;
    setActionKey(`delete-${schedule.id}`);
    try {
      await deleteWorkflowSchedule(schedule.id);
      setSchedules((current) => current.filter((item) => item.id !== schedule.id));
      toast.success("调度已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除调度失败");
    } finally {
      setActionKey(null);
    }
  }

  async function inspectRun(run: WorkflowRun) {
    setSelectedRunId(run.id);
    setTab("runs");
    try {
      const current = await getWorkflowRun(run.id);
      setRuns((items) => items.map((item) => item.id === current.id ? current : item));
    } catch {
      // The list snapshot is sufficient if the detail refresh fails.
    }
  }

  const liveCount = runs.filter((run) => ["pending", "running"].includes(run.status)).length;
  const completedCount = runs.filter((run) => run.status === "completed").length;
  const tokenTotal = selectedRun?.nodes.reduce((sum, node) => sum + (node.total_tokens || 0), 0) ?? 0;
  const successRate = runs.length ? Math.round((completedCount / runs.length) * 100) : 0;
  const runtimeStats: Array<{ label: string; value: string | number; icon: LucideIcon; color: string }> = [
    { label: "LIVE RUNS", value: liveCount, icon: Activity, color: "#38BDF8" },
    { label: "SUCCESS RATE", value: `${successRate}%`, icon: ShieldCheck, color: "#2DD4BF" },
    { label: "SELECTED TOKENS", value: tokenTotal.toLocaleString("zh-CN"), icon: Zap, color: "#FBBF24" },
    { label: "ACTIVE SCHEDULES", value: schedules.filter((item) => item.enabled).length, icon: CalendarClock, color: "#A78BFA" }
  ];

  if (authenticated === false) {
    return (
      <PageShell className="min-h-[70vh]">
        <section className="relative grid min-h-[560px] place-items-center overflow-hidden rounded-lg border border-border bg-[#0A0D14] px-5 text-center text-white">
          <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(56,189,248,.13)_1px,transparent_1px),linear-gradient(90deg,rgba(56,189,248,.13)_1px,transparent_1px)] [background-size:36px_36px]" />
          <div className="relative max-w-md">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-md border border-[#38BDF8]/25 bg-[#38BDF8]/10 text-[#38BDF8]"><LockKeyhole className="h-6 w-6" /></span>
            <p className="mt-5 text-[10px] font-semibold uppercase text-[#38BDF8]">Runtime access required</p>
            <h2 className="mt-2 text-2xl font-semibold">执行引擎等待身份接入</h2>
            <p className="mt-3 text-sm leading-6 text-white/50">运行记录、审批节点和调度计划按账号隔离，请先登录当前工作区。</p>
            <button type="button" onClick={() => router.push("/login?next=/runs")} className="mt-6 inline-flex h-10 items-center gap-2 rounded-md bg-[#38BDF8] px-4 text-xs font-semibold text-[#071018] transition hover:bg-[#67CCF5]">
              接入工作区<ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </section>
      </PageShell>
    );
  }

  return (
    <PageShell className="space-y-4">
      <section className="relative overflow-hidden rounded-lg border border-white/10 bg-[#080C13] text-white shadow-[0_24px_80px_rgba(0,0,0,.22)]">
        <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(56,189,248,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(56,189,248,.12)_1px,transparent_1px)] [background-size:42px_42px]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#38BDF8] to-transparent" />
        <div className="relative grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-[9px] font-semibold uppercase text-white/45">
              <span className="inline-flex items-center gap-1.5 text-[#38BDF8]"><RadioTower className="h-3 w-3" />Orchestration fabric</span>
              <span>NODE TELEMETRY / HUMAN GATE / SCHEDULER</span>
            </div>
            <h2 className="mt-4 text-2xl font-semibold sm:text-3xl">把工作流从模板推进到可控执行。</h2>
            <p className="mt-2 max-w-2xl text-xs leading-6 text-white/50">追踪每个节点的输入、产出与消耗，在关键质量门暂停审批，并将稳定链路部署为周期任务。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setDraft({ ...emptyDraft }); setComposeOpen(true); }} className="inline-flex h-10 items-center gap-2 rounded-md bg-[#38BDF8] px-4 text-xs font-semibold text-[#071018] transition hover:bg-[#67CCF5]"><Plus className="h-4 w-4" />新建运行</button>
            <button type="button" onClick={() => router.push("/workflows")} className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs text-white/70 transition hover:bg-white/[0.08] hover:text-white"><SquareArrowOutUpRight className="h-3.5 w-3.5" />模板实验室</button>
          </div>
        </div>
        <div className="relative grid border-t border-white/10 sm:grid-cols-2 lg:grid-cols-4">
          {runtimeStats.map(({ label, value, icon: Icon, color }, index) => (
            <div key={label} className={cn("flex min-h-20 items-center gap-3 px-5 py-4", index > 0 && "border-t border-white/10 sm:border-l", index === 2 && "sm:border-l-0 lg:border-l", index > 1 && "sm:border-t lg:border-t-0")}>
              <span className="grid h-9 w-9 place-items-center rounded-md border border-white/10 bg-white/[0.035]" style={{ color }}><Icon className="h-4 w-4" /></span>
              <div><p className="font-mono text-lg font-semibold tabular-nums">{value}</p><p className="mt-0.5 text-[9px] font-semibold text-white/35">{label}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card/55 backdrop-blur-xl">
        <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div className="flex rounded-md border border-border bg-background/45 p-1" role="tablist" aria-label="执行控制台视图">
            <button type="button" role="tab" aria-selected={tab === "runs"} onClick={() => setTab("runs")} className={cn("inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-md px-3 text-[11px] font-medium transition sm:flex-none", tab === "runs" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}><Network className="h-3.5 w-3.5" />运行队列</button>
            <button type="button" role="tab" aria-selected={tab === "schedules"} onClick={() => setTab("schedules")} className={cn("inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-md px-3 text-[11px] font-medium transition sm:flex-none", tab === "schedules" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}><CalendarClock className="h-3.5 w-3.5" />调度矩阵</button>
          </div>
          <div className="flex items-center gap-2">
            {tab === "schedules" ? <button type="button" onClick={() => { if (selectedRun) { setDraft({ workflow_id: selectedRun.workflow_id, target: selectedRun.target, name: selectedRun.name, prompt: selectedRun.prompt, stepsText: selectedRun.nodes.filter((node) => node.node_type === "step").slice(0, 16).map((node) => `${node.name} | ${node.instruction}`).join("\n"), provider: selectedRun.provider, execution_mode: selectedRun.execution_mode, approval_required: selectedRun.approval_required, quality_gate: selectedRun.quality_gate }); } setScheduleOpen(true); }} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#A78BFA]/12 px-3 text-[11px] font-medium text-[#8B5CF6] transition hover:bg-[#A78BFA]/18"><Plus className="h-3.5 w-3.5" />部署调度</button> : null}
            <button type="button" aria-label="刷新执行数据" title="刷新" disabled={refreshing} onClick={() => void refreshData()} className="grid h-9 w-9 place-items-center rounded-md border border-border text-muted-foreground transition hover:bg-background hover:text-foreground disabled:opacity-50"><RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin motion-reduce:animate-none")} /></button>
          </div>
        </div>

        {loading ? (
          <div className="grid min-h-[520px] place-items-center"><div className="text-center"><LoaderCircle className="mx-auto h-5 w-5 animate-spin text-[#38BDF8] motion-reduce:animate-none" /><p className="mt-3 text-xs text-muted-foreground">正在同步执行引擎</p></div></div>
        ) : tab === "runs" ? (
          <div className="grid min-h-[700px] xl:h-[790px] xl:grid-cols-[310px_minmax(0,1fr)]">
            <aside className="soft-scrollbar max-h-[430px] overflow-y-auto border-b border-border p-2.5 xl:max-h-none xl:border-b-0 xl:border-r">
              {runs.length ? <div className="space-y-1.5">{runs.map((run) => {
                const active = selectedRun?.id === run.id;
                const progress = runProgress(run);
                const hasNodeSnapshot = run.nodes.length > 0;
                return (
                  <button key={run.id} type="button" onClick={() => void inspectRun(run)} aria-pressed={active} className={cn("relative w-full overflow-hidden rounded-md border p-3 text-left transition", active ? "border-[#38BDF8]/25 bg-[#38BDF8]/[0.055]" : "border-transparent hover:border-border hover:bg-background/55")}>
                    {active ? <span className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-[#38BDF8] shadow-[0_0_12px_#38BDF8]" /> : null}
                    <div className="flex items-start justify-between gap-3"><span className="min-w-0"><span className="block truncate text-xs font-semibold">{run.name}</span><span className="mt-1 block truncate font-mono text-[9px] text-muted-foreground">RUN-{String(run.id).padStart(5, "0")} · {formatDate(run.created_at)}</span></span><RunStatus status={run.status} pulse /></div>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-border"><span className="block h-full rounded-full bg-[#38BDF8] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${hasNodeSnapshot ? progress : 0}%` }} /></div>
                    <div className="mt-2 flex items-center justify-between text-[9px] text-muted-foreground"><span>{run.target === "image" ? "IMAGE" : "CHAT"} · {hasNodeSnapshot ? `${run.nodes.length} NODES` : "DETAIL ON SELECT"} · {run.execution_mode === "parallel" ? "PARALLEL" : "SEQUENTIAL"}</span><span className="font-mono">{hasNodeSnapshot ? `${progress}%` : "--"}</span></div>
                  </button>
                );
              })}</div> : <EmptyRuntime onCreate={() => setComposeOpen(true)} />}
            </aside>

            {selectedRun ? (
              <div className="grid min-w-0 lg:grid-cols-[minmax(330px,.92fr)_minmax(360px,1.08fr)] xl:min-h-0">
                <section className="soft-scrollbar border-b border-border p-4 sm:p-5 lg:border-b-0 lg:border-r xl:overflow-y-auto">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-base font-semibold">{selectedRun.name}</h3><RunStatus status={selectedRun.status} pulse /></div><p className="mt-1 flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground">{selectedRun.target === "image" ? <ImageIcon className="h-3 w-3 text-[#FB7185]" /> : <MessageSquareText className="h-3 w-3 text-[#2DD4BF]" />}RUN-{String(selectedRun.id).padStart(5, "0")} / {selectedRun.provider.toUpperCase()} / {selectedRun.model || "AUTO MODEL"}</p></div>
                    <RunControls run={selectedRun} actionKey={actionKey} onAction={runAction} />
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
                    {[
                      ["MODE", `${selectedRun.target === "image" ? "生图" : "对话"} · ${selectedRun.execution_mode === "parallel" ? "并行" : "顺序"}`],
                      ["QUALITY", qualityLabel(selectedRun.quality_status, selectedRun.quality_gate)],
                      ["APPROVAL", selectedRun.approval_required ? "人工门" : "自动"],
                      ["TOKENS", selectedRun.nodes.reduce((sum, node) => sum + (node.total_tokens || 0), 0).toLocaleString("zh-CN")]
                    ].map(([label, value]) => <div key={label} className="bg-card/90 px-3 py-3"><p className="text-[8px] font-bold text-muted-foreground">{label}</p><p className="mt-1 truncate text-[11px] font-semibold">{value}</p></div>)}
                  </div>

                  {selectedRun.error ? <div className="mt-4 flex gap-2 rounded-md border border-[#FB7185]/20 bg-[#FB7185]/[0.06] p-3 text-[11px] leading-5 text-[#E85D75]"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{selectedRun.error}</div> : null}
                  {selectedRun.quality_feedback ? <div className="mt-4 flex gap-2 rounded-md border border-[#A78BFA]/20 bg-[#A78BFA]/[0.06] p-3 text-[11px] leading-5 text-[#8B5CF6]"><BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />{selectedRun.quality_feedback}</div> : null}

                  <div className="mt-6 flex items-center justify-between"><span className="text-[9px] font-bold text-muted-foreground">EXECUTION GRAPH</span><span className="font-mono text-[9px] text-muted-foreground">{selectedRun.nodes.filter((node) => node.status === "completed").length}/{selectedRun.nodes.length} COMPLETE</span></div>
                  <div className="mt-3">
                    {selectedRun.nodes.map((node, index) => <RuntimeNode key={node.node_key} node={node} index={index} last={index === selectedRun.nodes.length - 1} selected={selectedNode?.node_key === node.node_key} onSelect={() => setSelectedNodeKey(node.node_key)} onRetry={() => void runAction(`retry-${node.node_key}`, () => retryWorkflowRun(selectedRun.id, node.node_key))} retrying={actionKey === `retry-${node.node_key}`} />)}
                  </div>
                </section>

                <section className="flex min-h-[560px] min-w-0 flex-col overflow-hidden bg-[#090D14] text-white xl:min-h-0">
                  <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5"><span className="flex min-w-0 items-center gap-2 text-[10px] font-semibold text-white/55"><Cpu className="h-3.5 w-3.5 shrink-0 text-[#38BDF8]" /><span className="truncate">{selectedNode ? selectedNode.name : "FINAL OUTPUT"}</span></span>{selectedNode ? <span className="font-mono text-[9px] text-white/35">ATTEMPT {selectedNode.attempt}</span> : null}</div>
                  <div className="soft-scrollbar flex-1 overflow-y-auto p-4 sm:p-5">
                    {selectedRun.target === "image" && selectedRun.image_base64 ? <div><figure className="overflow-hidden border border-white/10 bg-black"><img src={`data:image/png;base64,${selectedRun.image_base64}`} alt={`${selectedRun.name} 生成结果`} className="h-auto max-h-[560px] w-full object-contain" /><figcaption className="flex items-center justify-between border-t border-white/10 px-3 py-2 font-mono text-[9px] text-white/35"><span>IMAGE ARTIFACT</span><span>RECORD-{selectedRun.image_record_id ?? "--"}</span></figcaption></figure>{selectedNode ? <details className="mt-4"><summary className="cursor-pointer list-none text-[10px] font-semibold text-[#38BDF8]">查看当前节点遥测</summary><div className="mt-4"><NodeInspector node={selectedNode} /></div></details> : null}</div> : selectedNode ? <NodeInspector node={selectedNode} /> : selectedRun.final_output ? <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-6 text-white/70">{selectedRun.final_output}</pre> : <div className="grid min-h-[360px] place-items-center text-center"><div><CircleDashed className="mx-auto h-5 w-5 text-white/20" /><p className="mt-3 text-xs text-white/40">节点尚未产生输出</p></div></div>}
                  </div>
                  {selectedRun.final_output ? <div className="border-t border-white/10 p-4 sm:p-5"><details><summary className="cursor-pointer list-none text-[10px] font-semibold text-[#2DD4BF]">{selectedRun.target === "image" ? "查看最终生成 Prompt" : "查看最终合成结果"}</summary><pre className="mt-3 max-h-52 overflow-y-auto whitespace-pre-wrap break-words border-l border-[#2DD4BF]/30 pl-3 font-mono text-[10px] leading-5 text-white/60">{selectedRun.final_output}</pre></details></div> : null}
                </section>
              </div>
            ) : <div className="grid min-h-[560px] place-items-center"><EmptyRuntime onCreate={() => setComposeOpen(true)} /></div>}
          </div>
        ) : (
          <ScheduleMatrix schedules={schedules} runs={runs} actionKey={actionKey} onToggle={toggleSchedule} onDelete={removeSchedule} onRunNow={(schedule) => void runAction(`run-now-${schedule.id}`, async () => { const run = await runWorkflowScheduleNow(schedule.id); setTab("runs"); return run; })} onInspectRun={(runId) => { setSelectedRunId(runId); setTab("runs"); }} onCreate={() => setScheduleOpen(true)} />
        )}
      </section>

      {(composeOpen || scheduleOpen) ? <RuntimeComposer draft={draft} setDraft={setDraft} schedule={scheduleOpen} scheduleType={scheduleType} setScheduleType={setScheduleType} scheduleAt={scheduleAt} setScheduleAt={setScheduleAt} submitting={actionKey === "create-run" || actionKey === "create-schedule"} onClose={() => { setComposeOpen(false); setScheduleOpen(false); }} onSubmit={() => void (scheduleOpen ? submitSchedule() : submitRun())} /> : null}
    </PageShell>
  );
}

function RunControls({ run, actionKey, onAction }: { run: WorkflowRun; actionKey: string | null; onAction: (label: string, action: () => Promise<WorkflowRun>) => Promise<void> }) {
  const waitingApproval = ["waiting_approval", "awaiting_approval"].includes(run.status);
  const busy = Boolean(actionKey);
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {run.status === "running" ? <button type="button" disabled={busy} onClick={() => void onAction("pause", () => pauseWorkflowRun(run.id))} title="暂停运行" aria-label="暂停运行" className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted-foreground transition hover:bg-[#FBBF24]/10 hover:text-[#D69B00] disabled:opacity-40"><Pause className="h-3.5 w-3.5" /></button> : null}
      {run.status === "paused" ? <button type="button" disabled={busy} onClick={() => void onAction("resume", () => resumeWorkflowRun(run.id))} title="继续运行" aria-label="继续运行" className="grid h-8 w-8 place-items-center rounded-md bg-[#38BDF8]/12 text-[#0EA5E9] transition hover:bg-[#38BDF8]/20 disabled:opacity-40"><Play className="h-3.5 w-3.5" /></button> : null}
      {waitingApproval ? <button type="button" disabled={busy} onClick={() => void onAction("approve", () => approveWorkflowRun(run.id))} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#A78BFA]/14 px-2.5 text-[10px] font-semibold text-[#8B5CF6] transition hover:bg-[#A78BFA]/22 disabled:opacity-40"><Check className="h-3.5 w-3.5" />批准</button> : null}
      {run.status === "failed" ? <button type="button" disabled={busy} onClick={() => void onAction("retry", () => retryWorkflowRun(run.id, run.nodes.find((node) => node.status === "failed")?.node_key ?? run.nodes[Math.max(0, run.current_node_index)]?.node_key))} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#FB7185]/12 px-2.5 text-[10px] font-semibold text-[#E85D75] transition hover:bg-[#FB7185]/20 disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" />重试</button> : null}
    </div>
  );
}

function RuntimeNode({ node, index, last, selected, onSelect, onRetry, retrying }: { node: WorkflowRunNode; index: number; last: boolean; selected: boolean; onSelect: () => void; onRetry: () => void; retrying: boolean }) {
  const meta = getStatusMeta(node.status);
  return (
    <div className="relative flex gap-3 pb-3 last:pb-0">
      {!last ? <span className="absolute left-[15px] top-8 h-[calc(100%-8px)] w-px bg-border" /> : null}
      <span className={cn("relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-md border bg-background font-mono text-[9px] font-bold", node.status === "running" ? "border-[#38BDF8]/50 text-[#38BDF8] shadow-[0_0_14px_rgba(56,189,248,.18)]" : node.status === "completed" ? "border-[#2DD4BF]/30 text-[#14B8A6]" : node.status === "failed" ? "border-[#FB7185]/30 text-[#E85D75]" : "border-border text-muted-foreground")}>{node.status === "running" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : node.status === "completed" ? <Check className="h-3.5 w-3.5" /> : String(index + 1).padStart(2, "0")}</span>
      <button type="button" onClick={onSelect} className={cn("min-w-0 flex-1 rounded-md border px-3 py-2.5 text-left transition", selected ? "border-[#38BDF8]/25 bg-[#38BDF8]/[0.05]" : "border-transparent hover:border-border hover:bg-background/50")}>
        <span className="flex items-start justify-between gap-3"><span className="min-w-0"><span className="block truncate text-[11px] font-semibold">{node.name}</span><span className="mt-1 line-clamp-2 block text-[9px] leading-4 text-muted-foreground">{node.instruction}</span></span><RunStatus status={node.status} pulse /></span>
        <span className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[8px] text-muted-foreground"><span>{formatDuration(node.duration_ms)}</span><span>{node.total_tokens || 0} TOKENS</span><span>TRY {node.attempt}</span></span>
      </button>
      {node.status === "failed" ? <button type="button" onClick={onRetry} disabled={retrying} title="从此节点重试" aria-label={`从${node.name}重试`} className="mt-2 grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#E85D75] transition hover:bg-[#FB7185]/10 disabled:opacity-40"><ListRestart className={cn("h-3.5 w-3.5", retrying && "animate-spin motion-reduce:animate-none")} /></button> : null}
    </div>
  );
}

function NodeInspector({ node }: { node: WorkflowRunNode }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-4">
        {[["STATUS", getStatusMeta(node.status).label], ["DURATION", formatDuration(node.duration_ms)], ["TOKENS", node.total_tokens || 0], ["ATTEMPT", node.attempt]].map(([label, value]) => <div key={label} className="bg-[#0B1019] px-3 py-3"><p className="text-[8px] font-bold text-white/30">{label}</p><p className="mt-1 truncate font-mono text-[10px] text-white/70">{value}</p></div>)}
      </div>
      <div><p className="text-[9px] font-bold text-white/35">NODE INSTRUCTION</p><p className="mt-2 border-l border-[#38BDF8]/30 pl-3 text-[11px] leading-5 text-white/60">{node.instruction}</p></div>
      {node.input_text ? <div><p className="text-[9px] font-bold text-white/35">INPUT SNAPSHOT</p><pre className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-white/10 bg-white/[0.025] p-3 font-mono text-[10px] leading-5 text-white/50">{node.input_text}</pre></div> : null}
      <div><p className="text-[9px] font-bold text-white/35">NODE OUTPUT</p>{node.output_text ? <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-6 text-white/72">{node.output_text}</pre> : node.error ? <p className="mt-2 text-[11px] leading-5 text-[#FB7185]">{node.error}</p> : <p className="mt-2 text-[11px] text-white/35">等待节点产生输出。</p>}</div>
    </div>
  );
}

function ScheduleMatrix({ schedules, runs, actionKey, onToggle, onDelete, onRunNow, onInspectRun, onCreate }: { schedules: WorkflowSchedule[]; runs: WorkflowRun[]; actionKey: string | null; onToggle: (schedule: WorkflowSchedule) => void; onDelete: (schedule: WorkflowSchedule) => void; onRunNow: (schedule: WorkflowSchedule) => void; onInspectRun: (runId: number) => void; onCreate: () => void }) {
  if (!schedules.length) return <div className="grid min-h-[620px] place-items-center"><div className="text-center"><CalendarClock className="mx-auto h-6 w-6 text-muted-foreground/30" /><h3 className="mt-3 text-sm font-semibold">调度矩阵尚未部署</h3><p className="mt-1 text-xs text-muted-foreground">将验证稳定的链路设置为单次或周期任务。</p><button type="button" onClick={onCreate} className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-[#A78BFA]/12 px-3 text-[11px] font-semibold text-[#8B5CF6]"><Plus className="h-3.5 w-3.5" />创建调度</button></div></div>;
  return (
    <div className="p-3 sm:p-4">
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {schedules.map((schedule) => {
          const linkedRun = schedule.last_run_id ? runs.find((run) => run.id === schedule.last_run_id) : null;
          return (
            <article key={schedule.id} className="relative overflow-hidden rounded-md border border-border bg-background/45 p-4">
              <span className={cn("absolute inset-y-0 left-0 w-0.5", schedule.enabled ? "bg-[#A78BFA]" : "bg-muted-foreground/25")} />
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-xs font-semibold">{schedule.name}</h3>{schedule.enabled ? <span className="rounded-sm bg-[#2DD4BF]/10 px-1.5 py-0.5 text-[8px] font-bold text-[#14B8A6]">ONLINE</span> : <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[8px] font-bold text-muted-foreground">PAUSED</span>}</div><p className="mt-1 font-mono text-[9px] text-muted-foreground">SCHEDULE-{String(schedule.id).padStart(4, "0")}</p></div><button type="button" role="switch" aria-checked={schedule.enabled} aria-label={`${schedule.enabled ? "暂停" : "启用"}${schedule.name}`} disabled={actionKey === `toggle-${schedule.id}`} onClick={() => onToggle(schedule)} className={cn("relative h-5 w-9 rounded-full border transition", schedule.enabled ? "border-[#2DD4BF]/30 bg-[#2DD4BF]/20" : "border-border bg-muted")}><span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full transition-transform", schedule.enabled ? "translate-x-[17px] bg-[#2DD4BF]" : "translate-x-0.5 bg-muted-foreground/50")} /></button></div>
              <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border"><div className="bg-card/80 p-3"><p className="text-[8px] font-bold text-muted-foreground">CADENCE</p><p className="mt-1 text-[11px] font-semibold">{schedule.schedule_type === "once" ? "单次" : schedule.schedule_type === "daily" ? "每日" : "每周"}</p></div><div className="bg-card/80 p-3"><p className="text-[8px] font-bold text-muted-foreground">NEXT SIGNAL</p><p className="mt-1 font-mono text-[10px] font-semibold">{formatDate(schedule.next_run_at)}</p></div></div>
              <div className="mt-3 flex items-center justify-between text-[9px] text-muted-foreground"><span className="inline-flex items-center gap-1.5"><Clock3 className="h-3 w-3" />上次 {formatDate(schedule.last_run_at)}</span><span>{schedule.execution_mode === "parallel" ? "PARALLEL" : "SEQUENTIAL"}</span></div>
              <div className="mt-4 flex items-center gap-2 border-t border-border pt-3"><button type="button" disabled={Boolean(actionKey)} onClick={() => onRunNow(schedule)} className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-[#A78BFA]/12 text-[10px] font-semibold text-[#8B5CF6] transition hover:bg-[#A78BFA]/20 disabled:opacity-40">{actionKey === `run-now-${schedule.id}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}立即运行</button>{linkedRun ? <button type="button" onClick={() => onInspectRun(linkedRun.id)} title="查看最近运行" aria-label="查看最近运行" className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted-foreground transition hover:text-foreground"><SquareArrowOutUpRight className="h-3.5 w-3.5" /></button> : null}<button type="button" onClick={() => onDelete(schedule)} title="删除调度" aria-label="删除调度" className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition hover:bg-[#FB7185]/10 hover:text-[#E85D75]"><Trash2 className="h-3.5 w-3.5" /></button></div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function RuntimeComposer({ draft, setDraft, schedule, scheduleType, setScheduleType, scheduleAt, setScheduleAt, submitting, onClose, onSubmit }: { draft: RuntimeDraft; setDraft: React.Dispatch<React.SetStateAction<RuntimeDraft>>; schedule: boolean; scheduleType: WorkflowScheduleType; setScheduleType: (value: WorkflowScheduleType) => void; scheduleAt: string; setScheduleAt: (value: string) => void; submitting: boolean; onClose: () => void; onSubmit: () => void }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => {
      const firstField = dialogRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), textarea:not([disabled]), select:not([disabled])'
      );
      (firstField ?? dialogRef.current)?.focus();
    }, 0);

    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeys);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeys);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-black/70 p-3 backdrop-blur-md sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="runtime-composer-title" tabIndex={-1} className="mx-auto my-3 w-full max-w-4xl overflow-hidden rounded-lg border border-white/10 bg-[#0B1018] text-white shadow-2xl outline-none sm:my-8">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-4 sm:px-6"><div><p className="text-[9px] font-bold text-[#38BDF8]">{schedule ? "DEPLOY SCHEDULE" : "CREATE RUNTIME"}</p><h2 id="runtime-composer-title" className="mt-1 text-base font-semibold">{schedule ? "部署自动化调度" : "配置执行链路"}</h2></div><button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-white/45 transition hover:bg-white/10 hover:text-white" aria-label="关闭"><span className="text-lg leading-none">×</span></button></div>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4 p-4 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="mb-1.5 block text-[10px] font-semibold text-white/55">运行名称</span><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className="h-10 w-full rounded-md border border-white/10 bg-white/[0.035] px-3 text-xs outline-none transition focus:border-[#38BDF8]/60 focus:ring-2 focus:ring-[#38BDF8]/20" /></label><label className="block"><span className="mb-1.5 block text-[10px] font-semibold text-white/55">工作流标识</span><input value={draft.workflow_id} onChange={(event) => setDraft((current) => ({ ...current, workflow_id: event.target.value }))} className="h-10 w-full rounded-md border border-white/10 bg-white/[0.035] px-3 font-mono text-[11px] outline-none transition focus:border-[#38BDF8]/60 focus:ring-2 focus:ring-[#38BDF8]/20" /></label></div>
            <label className="block"><span className="mb-1.5 flex items-center justify-between text-[10px] font-semibold text-white/55"><span>主任务 Prompt</span><span className="font-mono font-normal text-white/25">{draft.prompt.length} CHARS</span></span><textarea value={draft.prompt} onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))} rows={8} placeholder="描述完整任务、上下文、约束和期望交付物" className="soft-scrollbar w-full resize-y rounded-md border border-white/10 bg-white/[0.035] px-3 py-2.5 font-mono text-[11px] leading-5 outline-none transition placeholder:text-white/20 focus:border-[#38BDF8]/60 focus:ring-2 focus:ring-[#38BDF8]/20" /></label>
            <label className="block"><span className="mb-1.5 flex items-center justify-between text-[10px] font-semibold text-white/55"><span>执行节点</span><span className="font-normal text-white/25">每行：节点名 | 指令</span></span><textarea value={draft.stepsText} onChange={(event) => setDraft((current) => ({ ...current, stepsText: event.target.value }))} rows={6} className="soft-scrollbar w-full resize-y rounded-md border border-white/10 bg-white/[0.035] px-3 py-2.5 font-mono text-[10px] leading-5 outline-none transition focus:border-[#38BDF8]/60 focus:ring-2 focus:ring-[#38BDF8]/20" /></label>
          </div>
          <aside className="border-t border-white/10 p-4 sm:p-6 lg:border-l lg:border-t-0">
            <p className="text-[9px] font-bold text-white/35">RUNTIME POLICY</p>
            <div className="mt-4 space-y-4">
              <div><span className="mb-1.5 block text-[10px] font-semibold text-white/55">输出通道</span><div className="grid grid-cols-2 gap-1 rounded-md border border-white/10 bg-white/[0.025] p-1">{(["chat", "image"] as const).map((target) => <button key={target} type="button" onClick={() => setDraft((current) => ({ ...current, target }))} className={cn("flex h-8 items-center justify-center gap-1.5 rounded-md text-[10px] font-medium transition", draft.target === target ? target === "image" ? "bg-[#FB7185] text-white" : "bg-[#2DD4BF] text-[#071018]" : "text-white/45 hover:text-white")}>{target === "image" ? <ImageIcon className="h-3 w-3" /> : <MessageSquareText className="h-3 w-3" />}{target === "image" ? "生图" : "对话"}</button>)}</div></div>
              <label className="block"><span className="mb-1.5 block text-[10px] font-semibold text-white/55">模型通道</span><select value={draft.provider} onChange={(event) => setDraft((current) => ({ ...current, provider: event.target.value === "grok" ? "grok" : "openai" }))} className="h-10 w-full rounded-md border border-white/10 bg-[#101620] px-3 text-xs outline-none focus:border-[#38BDF8]/60"><option value="openai">OpenAI</option><option value="grok">Grok</option></select></label>
              <div><span className="mb-1.5 block text-[10px] font-semibold text-white/55">执行拓扑</span><div className="grid grid-cols-2 gap-1 rounded-md border border-white/10 bg-white/[0.025] p-1">{(["sequential", "parallel"] as const).map((mode) => <button key={mode} type="button" onClick={() => setDraft((current) => ({ ...current, execution_mode: mode }))} className={cn("flex h-8 items-center justify-center gap-1.5 rounded-md text-[10px] font-medium transition", draft.execution_mode === mode ? "bg-white text-[#0B1018]" : "text-white/45 hover:text-white")} >{mode === "sequential" ? <GitBranch className="h-3 w-3" /> : <Network className="h-3 w-3" />}{mode === "sequential" ? "顺序" : "并行"}</button>)}</div></div>
              <PolicyToggle icon={ShieldCheck} label="质量门校验" description="完成后自动检查交付质量" checked={draft.quality_gate} onChange={(checked) => setDraft((current) => ({ ...current, quality_gate: checked }))} />
              <PolicyToggle icon={BadgeCheck} label="人工审批" description="关键阶段等待确认后继续" checked={draft.approval_required} onChange={(checked) => setDraft((current) => ({ ...current, approval_required: checked }))} />
              {schedule ? <div className="space-y-4 border-t border-white/10 pt-4"><label className="block"><span className="mb-1.5 block text-[10px] font-semibold text-white/55">执行周期</span><select value={scheduleType} onChange={(event) => setScheduleType(event.target.value as WorkflowScheduleType)} className="h-10 w-full rounded-md border border-white/10 bg-[#101620] px-3 text-xs outline-none focus:border-[#A78BFA]/60"><option value="once">单次执行</option><option value="daily">每日执行</option><option value="weekly">每周执行</option></select></label><label className="block"><span className="mb-1.5 block text-[10px] font-semibold text-white/55">首次信号时间</span><input type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} className="h-10 w-full rounded-md border border-white/10 bg-[#101620] px-3 text-[11px] outline-none focus:border-[#A78BFA]/60" /></label></div> : null}
            </div>
          </aside>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-white/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><p className="text-[9px] text-white/30">{draft.target.toUpperCase()} · {parseSteps(draft.stepsText).length} NODES · {draft.execution_mode.toUpperCase()} · {draft.quality_gate ? "QUALITY GATE ON" : "DIRECT OUTPUT"}</p><div className="flex gap-2"><button type="button" onClick={onClose} className="h-9 rounded-md px-3 text-[11px] text-white/50 transition hover:bg-white/10 hover:text-white">取消</button><button type="button" disabled={submitting} onClick={onSubmit} className={cn("inline-flex h-9 items-center gap-2 rounded-md px-4 text-[11px] font-semibold transition disabled:opacity-50", schedule ? "bg-[#A78BFA] text-white hover:bg-[#B794F8]" : "bg-[#38BDF8] text-[#071018] hover:bg-[#67CCF5]")}>{submitting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : schedule ? <CalendarClock className="h-3.5 w-3.5" /> : <Rocket className="h-3.5 w-3.5" />}{schedule ? "上线调度" : "开始执行"}</button></div></div>
      </div>
    </div>,
    document.body
  );
}

function PolicyToggle({ icon: Icon, label, description, checked, onChange }: { icon: typeof Settings2; label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center gap-3 rounded-md border border-white/10 bg-white/[0.025] p-3 text-left transition hover:bg-white/[0.05]"><span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-md", checked ? "bg-[#38BDF8]/12 text-[#38BDF8]" : "bg-white/5 text-white/30")}><Icon className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1"><span className="block text-[10px] font-semibold">{label}</span><span className="mt-0.5 block text-[9px] leading-4 text-white/35">{description}</span></span><span className={cn("relative h-5 w-9 rounded-full border transition", checked ? "border-[#2DD4BF]/30 bg-[#2DD4BF]/20" : "border-white/10 bg-white/5")}><span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full transition-transform", checked ? "translate-x-[17px] bg-[#2DD4BF]" : "translate-x-0.5 bg-white/30")} /></span></button>;
}

function EmptyRuntime({ onCreate }: { onCreate: () => void }) {
  return <div className="px-6 py-14 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-md border border-border bg-background/60 text-[#38BDF8]"><Gauge className="h-5 w-5" /></span><h3 className="mt-4 text-sm font-semibold">暂无执行信号</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">从模板实验室装载链路，或直接创建一条运行。</p><button type="button" onClick={onCreate} className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-[#38BDF8]/12 px-3 text-[11px] font-semibold text-[#0EA5E9]"><Sparkles className="h-3.5 w-3.5" />创建运行</button></div>;
}
