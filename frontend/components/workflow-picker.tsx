"use client";

import {
  ArrowRight,
  BookOpenCheck,
  Bot,
  Boxes,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  CircleDotDashed,
  Clapperboard,
  Clock3,
  Copy,
  ImageIcon,
  Layers3,
  MessageSquareText,
  PanelTopOpen,
  Plus,
  Search,
  Sparkles,
  Star,
  UserRoundSearch,
  WandSparkles,
  X,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  WORKFLOW_LIBRARY_CHANGED_EVENT,
  WORKFLOW_USAGE_CHANGED_EVENT,
  buildWorkflowUrl,
  builtInWorkflows,
  compileWorkflow,
  getInitialWorkflowValues,
  getMissingRequiredFields,
  getWorkflowPromptLengthError,
  loadWorkflowUsage,
  loadCustomWorkflows,
  recordWorkflowUse,
  sortWorkflowsByActivity,
  toggleWorkflowFavorite,
  type WorkflowIconKey,
  type WorkflowTarget,
  type WorkflowTemplate,
  type WorkflowUsageState,
  type WorkflowValues
} from "@/lib/workflows";

const iconMap: Record<WorkflowIconKey, LucideIcon> = {
  research: BookOpenCheck,
  writing: PanelTopOpen,
  strategy: Boxes,
  meeting: BriefcaseBusiness,
  product: WandSparkles,
  cinema: Clapperboard,
  brand: Layers3,
  character: UserRoundSearch,
  custom: CircleDotDashed
};

export interface WorkflowPickerProps {
  target: WorkflowTarget;
  onApply?: (prompt: string, workflow: WorkflowTemplate) => void;
  className?: string;
  buttonLabel?: string;
  disabled?: boolean;
}

export function WorkflowPicker({ target, onApply, className, buttonLabel = "工作流", disabled = false }: WorkflowPickerProps) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [customWorkflows, setCustomWorkflows] = useState<WorkflowTemplate[]>([]);
  const [usage, setUsage] = useState<WorkflowUsageState>({ favorites: [], recent: [], useCounts: {} });
  const [selectedId, setSelectedId] = useState("");
  const [values, setValues] = useState<WorkflowValues>({});
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"all" | "favorites" | "recent">("all");
  const [mobilePanel, setMobilePanel] = useState<"library" | "configure">("library");

  const workflows = useMemo(
    () => sortWorkflowsByActivity([...builtInWorkflows, ...customWorkflows].filter((workflow) => workflow.target === target), usage),
    [customWorkflows, target, usage]
  );
  const filtered = workflows.filter((workflow) => {
    const matchesView =
      view === "all" ||
      (view === "favorites" && usage.favorites.includes(workflow.id)) ||
      (view === "recent" && usage.recent.some((entry) => entry.workflowId === workflow.id));
    const haystack = `${workflow.name} ${workflow.category} ${workflow.description} ${workflow.fields.map((field) => field.label).join(" ")}`.toLowerCase();
    return matchesView && haystack.includes(query.trim().toLowerCase());
  });
  if (view === "recent") {
    const recentOrder = new Map(usage.recent.map((entry, index) => [entry.workflowId, index]));
    filtered.sort(
      (left, right) =>
        (recentOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (recentOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    );
  }
  const selected = filtered.find((workflow) => workflow.id === selectedId) ?? filtered[0] ?? workflows[0];
  const preview = selected ? compileWorkflow(selected, values) : "";
  const missingFields = selected ? getMissingRequiredFields(selected, values) : [];

  useEffect(() => {
    const refresh = () => setCustomWorkflows(loadCustomWorkflows());
    refresh();
    window.addEventListener(WORKFLOW_LIBRARY_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(WORKFLOW_LIBRARY_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    const refresh = () => setUsage(loadWorkflowUsage());
    refresh();
    window.addEventListener(WORKFLOW_USAGE_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(WORKFLOW_USAGE_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id);
    setValues(getInitialWorkflowValues(selected));
    // The workflow id is the reset boundary; defaults should not overwrite active typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKeys);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleDialogKeys);
      (previouslyFocused ?? triggerRef.current)?.focus();
    };
  }, [open]);

  function selectWorkflow(workflow: WorkflowTemplate) {
    setSelectedId(workflow.id);
    setValues(getInitialWorkflowValues(workflow));
    setMobilePanel("configure");
  }

  function applyWorkflow() {
    if (!selected) return;
    if (missingFields.length) {
      toast.error(`请先填写：${missingFields.map((field) => field.label).join("、")}`);
      return;
    }
    const lengthError = getWorkflowPromptLengthError(selected.target, preview);
    if (lengthError) {
      toast.error(lengthError);
      return;
    }
    try {
      if (onApply) onApply(preview, selected);
      else router.push(buildWorkflowUrl(selected, preview));
      setUsage(recordWorkflowUse(selected.id));
      setOpen(false);
      toast.success(`已装载「${selected.name}」`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "工作流装载失败，请重试");
    }
  }

  function toggleFavorite() {
    if (!selected) return;
    const wasFavorite = usage.favorites.includes(selected.id);
    setUsage(toggleWorkflowFavorite(selected.id));
    toast.success(wasFavorite ? "已取消收藏" : `已收藏「${selected.name}」`);
  }

  async function copyPreview() {
    try {
      await navigator.clipboard.writeText(preview);
      toast.success("编译结果已复制");
    } catch {
      toast.error("无法访问剪贴板");
    }
  }

  const TargetIcon = target === "chat" ? MessageSquareText : ImageIcon;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => { setMobilePanel("library"); setOpen(true); }}
        className={cn(
          "group inline-flex h-9 items-center gap-2 rounded-md border border-[#5B7CFF]/30 bg-[#5B7CFF]/8 px-3 text-xs font-semibold text-[#6D87FF] transition hover:border-[#5B7CFF]/55 hover:bg-[#5B7CFF]/14 disabled:cursor-not-allowed disabled:opacity-45 dark:text-[#8EA2FF]",
          className
        )}
      >
        <span className="relative grid h-5 w-5 place-items-center">
          <Sparkles className="h-3.5 w-3.5 transition group-hover:rotate-12" />
        </span>
        {buttonLabel}
        <ChevronRight className="h-3 w-3 text-muted-foreground transition group-hover:translate-x-0.5" />
      </button>

      {open ? createPortal((
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[#070910]/70 p-0 backdrop-blur-md sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${target === "chat" ? "对话" : "生图"}工作流选择器`}
            tabIndex={-1}
            className="relative flex h-[96dvh] w-full max-w-[1180px] flex-col overflow-hidden rounded-t-lg border border-white/10 bg-background shadow-[0_30px_120px_rgba(0,0,0,0.55)] sm:h-[min(780px,88vh)] sm:rounded-lg"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#5B7CFF] to-transparent" />
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#5B7CFF]/12 text-[#718CFF]">
                  <TargetIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-sm font-semibold">装载{target === "chat" ? "对话" : "视觉"}工作流</h2>
                    <span className="hidden rounded-sm bg-[#2DD4BF]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#2DD4BF] sm:inline">LIVE COMPILER</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">选择模板，注入变量，然后发送到当前创作通道</p>
                </div>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="关闭工作流选择器" className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="grid shrink-0 grid-cols-2 border-b border-border p-1 lg:hidden" role="group" aria-label="工作流选择步骤">
              <button type="button" aria-pressed={mobilePanel === "library"} onClick={() => setMobilePanel("library")} className={cn("flex h-9 items-center justify-center gap-2 rounded-md text-xs font-medium", mobilePanel === "library" ? "bg-foreground text-background" : "text-muted-foreground")}><Search className="h-3.5 w-3.5" />选择模板</button>
              <button type="button" aria-pressed={mobilePanel === "configure"} onClick={() => setMobilePanel("configure")} disabled={!selected} className={cn("flex h-9 items-center justify-center gap-2 rounded-md text-xs font-medium disabled:opacity-40", mobilePanel === "configure" ? "bg-foreground text-background" : "text-muted-foreground")}><WandSparkles className="h-3.5 w-3.5" />配置变量</button>
            </div>

            <div className="grid min-h-0 flex-1 lg:grid-cols-[300px_minmax(0,1fr)]">
              <aside className={cn("min-h-0 flex-col border-b border-border bg-black/[0.018] dark:bg-white/[0.012] lg:flex lg:border-b-0 lg:border-r", mobilePanel === "library" ? "flex" : "hidden")}>
                <div className="p-3">
                  <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-background/70 px-3 focus-within:border-[#5B7CFF]/60">
                    <Search className="h-3.5 w-3.5 text-muted-foreground" />
                    <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模板或场景" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70" />
                  </label>
                  <div className="mt-2 grid grid-cols-3 gap-1 rounded-md border border-border bg-background/50 p-1" role="group" aria-label="筛选工作流模板">
                    {([[
                      "all", "全部", CircleDotDashed
                    ], [
                      "favorites", "收藏", Star
                    ], [
                      "recent", "最近", Clock3
                    ]] as const).map(([value, label, Icon]) => (
                      <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)} className={cn("flex h-7 items-center justify-center gap-1.5 rounded-md text-[10px] font-medium transition", view === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                        <Icon className="h-3 w-3" />{label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="soft-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3" role="group" aria-label="选择工作流模板">
                  {filtered.map((workflow) => {
                    const Icon = iconMap[workflow.iconKey] ?? Bot;
                    const active = selected?.id === workflow.id;
                    return (
                      <button
                        key={workflow.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => selectWorkflow(workflow)}
                        className={cn(
                          "group flex w-full items-start gap-3 rounded-md border border-transparent px-3 py-3 text-left transition",
                          active ? "border-border bg-card shadow-sm" : "hover:bg-black/[0.035] dark:hover:bg-white/[0.035]"
                        )}
                      >
                        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md" style={{ color: workflow.accent, backgroundColor: `${workflow.accent}18` }}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-xs font-semibold">{workflow.name}</span>
                            {usage.favorites.includes(workflow.id) ? <Star className="h-3 w-3 shrink-0 fill-[#FBBF24] text-[#FBBF24]" /> : null}
                            {workflow.custom ? <span className="rounded-sm bg-[#A78BFA]/10 px-1 py-0.5 text-[8px] font-bold text-[#A78BFA]">MY</span> : null}
                          </span>
                          <span className="mt-1 block line-clamp-2 text-[10px] leading-4 text-muted-foreground">{workflow.description}</span>
                          {usage.useCounts[workflow.id] ? <span className="mt-1 block text-[9px] text-[#14B8A6]">{usage.useCounts[workflow.id]} 次使用</span> : null}
                        </span>
                        {active ? <Check className="mt-1 h-3.5 w-3.5 shrink-0" style={{ color: workflow.accent }} /> : null}
                      </button>
                    );
                  })}
                  {!filtered.length ? <p className="px-3 py-8 text-center text-xs text-muted-foreground">没有匹配的模板</p> : null}
                </div>
                <Link href="/workflows" className="m-3 mt-0 flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-dashed border-border text-[11px] font-medium text-muted-foreground transition hover:border-[#5B7CFF]/45 hover:text-foreground">
                  <Plus className="h-3.5 w-3.5" />
                  创建自定义模板
                </Link>
              </aside>

              {selected ? (
                <main className={cn("soft-scrollbar min-h-0 overflow-y-auto lg:block", mobilePanel === "configure" ? "block" : "hidden")}>
                  <div className="grid min-h-full xl:grid-cols-[minmax(0,0.92fr)_minmax(340px,1.08fr)]">
                    <section className="border-b border-border p-4 sm:p-5 xl:border-b-0 xl:border-r">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[9px] font-bold uppercase text-muted-foreground">VARIABLE MATRIX</p>
                          <h3 className="mt-1 text-base font-semibold">配置任务变量</h3>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button type="button" onClick={toggleFavorite} aria-label={usage.favorites.includes(selected.id) ? "取消收藏" : "收藏工作流"} aria-pressed={usage.favorites.includes(selected.id)} title={usage.favorites.includes(selected.id) ? "取消收藏" : "收藏"} className={cn("grid h-8 w-8 place-items-center rounded-md transition hover:bg-[#FBBF24]/10", usage.favorites.includes(selected.id) ? "text-[#FBBF24]" : "text-muted-foreground hover:text-[#FBBF24]")}>
                            <Star className={cn("h-3.5 w-3.5", usage.favorites.includes(selected.id) && "fill-current")} />
                          </button>
                          <span className="text-[10px] tabular-nums text-muted-foreground">{selected.fields.length} INPUTS</span>
                        </div>
                      </div>
                      <div className="mt-5 space-y-4">
                        {selected.fields.map((field) => (
                          <label key={field.key} className="block">
                            <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium">
                              {field.label}
                              {field.required ? <span className="text-[#FB7185]">*</span> : <span className="text-[9px] font-normal text-muted-foreground">可选</span>}
                            </span>
                            {field.type === "textarea" ? (
                              <textarea
                                required={field.required}
                                aria-required={field.required}
                                value={values[field.key] ?? ""}
                                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                                placeholder={field.placeholder}
                                rows={3}
                                className="w-full resize-y rounded-md border border-border bg-card/40 px-3 py-2.5 text-xs leading-5 outline-none transition placeholder:text-muted-foreground/55 focus-visible:border-[#5B7CFF]/70 focus-visible:ring-2 focus-visible:ring-[#5B7CFF]/30"
                              />
                            ) : field.type === "select" ? (
                              <select required={field.required} aria-required={field.required} value={values[field.key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} className="h-10 w-full rounded-md border border-border bg-card/40 px-3 text-xs outline-none transition focus-visible:border-[#5B7CFF]/70 focus-visible:ring-2 focus-visible:ring-[#5B7CFF]/30">
                                {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
                              </select>
                            ) : (
                              <input
                                required={field.required}
                                aria-required={field.required}
                                value={values[field.key] ?? ""}
                                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                                placeholder={field.placeholder}
                                className="h-10 w-full rounded-md border border-border bg-card/40 px-3 text-xs outline-none transition placeholder:text-muted-foreground/55 focus-visible:border-[#5B7CFF]/70 focus-visible:ring-2 focus-visible:ring-[#5B7CFF]/30"
                              />
                            )}
                          </label>
                        ))}
                      </div>
                    </section>

                    <section className="flex min-h-[420px] flex-col bg-[#0B0E15] text-white">
                      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
                        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase text-white/60">
                          <CircleDotDashed className="h-3.5 w-3.5 text-[#2DD4BF]" />
                          Prompt output
                        </div>
                        <button type="button" onClick={copyPreview} aria-label="复制编译结果" className="grid h-8 w-8 place-items-center rounded-md text-white/50 transition hover:bg-white/10 hover:text-white">
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <pre className="soft-scrollbar min-h-[260px] flex-1 whitespace-pre-wrap break-words p-4 font-mono text-[11px] leading-6 text-white/72 sm:p-5">{preview}</pre>
                      <div className="border-t border-white/10 p-4 sm:p-5">
                        <div className="mb-3 flex items-center justify-between gap-3 text-[10px] text-white/45">
                          <span>{preview.length.toLocaleString("zh-CN")} CHARACTERS</span>
                          <span className={missingFields.length ? "text-[#FB7185]" : "text-[#2DD4BF]"}>{missingFields.length ? `${missingFields.length} REQUIRED` : "READY"}</span>
                        </div>
                        <button type="button" onClick={applyWorkflow} className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#5B7CFF] text-sm font-semibold text-white shadow-[0_10px_35px_rgba(91,124,255,0.28)] transition hover:bg-[#6A88FF]">
                          装载到{target === "chat" ? "对话" : "视觉工坊"}
                          <ArrowRight className="h-4 w-4" />
                        </button>
                      </div>
                    </section>
                  </div>
                </main>
              ) : null}
            </div>
          </div>
        </div>
      ), document.body) : null}
    </>
  );
}
