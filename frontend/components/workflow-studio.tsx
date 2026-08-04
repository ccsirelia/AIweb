"use client";

import {
  ArrowRight,
  BookOpenCheck,
  Bot,
  Boxes,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  CircleDotDashed,
  Clapperboard,
  Clock3,
  Copy,
  Download,
  Files,
  ImageIcon,
  Layers3,
  MessageSquareText,
  Network,
  Plus,
  RadioTower,
  Rocket,
  Search,
  Sparkles,
  Star,
  Trash2,
  TrendingUp,
  Upload,
  UserRoundSearch,
  WandSparkles,
  X,
  type LucideIcon
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { PageShell } from "@/components/page-shell";
import { cn } from "@/lib/utils";
import { saveWorkflowRuntimeHandoff } from "@/lib/workflow-runtime";
import {
  WORKFLOW_LIBRARY_CHANGED_EVENT,
  WORKFLOW_USAGE_CHANGED_EVENT,
  buildWorkflowUrl,
  builtInWorkflows,
  compileWorkflow,
  createCustomWorkflowId,
  deleteCustomWorkflow,
  fieldKeyFromLabel,
  getInitialWorkflowValues,
  getMissingRequiredFields,
  getWorkflowPromptLengthError,
  getWorkflowStats,
  loadCustomWorkflows,
  loadWorkflowUsage,
  recordWorkflowUse,
  saveCustomWorkflow,
  sortWorkflowsByActivity,
  toggleWorkflowFavorite,
  type WorkflowField,
  type WorkflowFieldType,
  type WorkflowIconKey,
  type WorkflowTarget,
  type WorkflowTemplate,
  type WorkflowUsageState,
  type WorkflowValues
} from "@/lib/workflows";

const iconMap: Record<WorkflowIconKey, LucideIcon> = {
  research: BookOpenCheck,
  writing: Bot,
  strategy: Boxes,
  meeting: BriefcaseBusiness,
  product: WandSparkles,
  cinema: Clapperboard,
  brand: Layers3,
  character: UserRoundSearch,
  custom: CircleDotDashed
};

const accentOptions = ["#5B7CFF", "#2DD4BF", "#FB7185", "#FBBF24", "#A78BFA", "#38BDF8"];

interface DraftField extends WorkflowField {
  rowId: string;
  optionsText: string;
}

interface WorkflowDraft {
  name: string;
  category: string;
  description: string;
  target: WorkflowTarget;
  accent: string;
  fields: DraftField[];
  stepsText: string;
  promptTemplate: string;
}

type ActivityFilter = "all" | "favorites" | "recent" | "popular";

const emptyDraft: WorkflowDraft = {
  name: "",
  category: "我的模板",
  description: "",
  target: "chat",
  accent: "#5B7CFF",
  fields: [
    {
      rowId: "field-initial",
      key: "主题",
      label: "主题",
      type: "textarea",
      placeholder: "输入本次任务的核心内容",
      required: true,
      optionsText: ""
    }
  ],
  stepsText: "理解任务 | 提取目标、约束和必要上下文\n组织结果 | 按清晰结构完成最终输出",
  promptTemplate: "请围绕以下主题完成任务：\n\n{{主题}}\n\n请给出结构清晰、具体可执行的结果。"
};

function cloneEmptyDraft(): WorkflowDraft {
  return {
    ...emptyDraft,
    fields: emptyDraft.fields.map((field) => ({ ...field, rowId: `field-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }))
  };
}

export function WorkflowStudio() {
  const router = useRouter();
  const [customWorkflows, setCustomWorkflows] = useState<WorkflowTemplate[]>([]);
  const [usage, setUsage] = useState<WorkflowUsageState>({ favorites: [], recent: [], useCounts: {} });
  const [target, setTarget] = useState<WorkflowTarget | "all">("all");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [category, setCategory] = useState("全部");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(builtInWorkflows[0].id);
  const [values, setValues] = useState<WorkflowValues>(() => getInitialWorkflowValues(builtInWorkflows[0]));
  const [builderOpen, setBuilderOpen] = useState(false);
  const [draft, setDraft] = useState<WorkflowDraft>(cloneEmptyDraft);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const builderDialogRef = useRef<HTMLDivElement | null>(null);

  const workflows = useMemo(
    () => sortWorkflowsByActivity([...customWorkflows, ...builtInWorkflows], usage),
    [customWorkflows, usage]
  );
  const categories = useMemo(
    () => ["全部", ...Array.from(new Set(workflows.filter((item) => target === "all" || item.target === target).map((item) => item.category)))],
    [target, workflows]
  );
  const filteredWorkflows = workflows.filter((workflow) => {
    const matchesTarget = target === "all" || workflow.target === target;
    const matchesCategory = category === "全部" || workflow.category === category;
    const matchesActivity =
      activityFilter === "all" ||
      (activityFilter === "favorites" && usage.favorites.includes(workflow.id)) ||
      (activityFilter === "recent" && usage.recent.some((entry) => entry.workflowId === workflow.id)) ||
      (activityFilter === "popular" && (usage.useCounts[workflow.id] ?? 0) > 0);
    const haystack = `${workflow.name} ${workflow.category} ${workflow.description} ${workflow.fields.map((field) => field.label).join(" ")} ${workflow.steps.map((step) => step.title).join(" ")}`.toLowerCase();
    return matchesTarget && matchesCategory && matchesActivity && haystack.includes(query.trim().toLowerCase());
  });
  if (activityFilter === "recent") {
    const recentOrder = new Map(usage.recent.map((entry, index) => [entry.workflowId, index]));
    filteredWorkflows.sort(
      (left, right) =>
        (recentOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (recentOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    );
  } else if (activityFilter === "popular") {
    filteredWorkflows.sort(
      (left, right) => (usage.useCounts[right.id] ?? 0) - (usage.useCounts[left.id] ?? 0)
    );
  }
  const selected =
    filteredWorkflows.find((workflow) => workflow.id === selectedId) ??
    filteredWorkflows[0] ??
    workflows.find((workflow) => workflow.id === selectedId) ??
    workflows[0];
  const preview = selected ? compileWorkflow(selected, values) : "";
  const missingFields = selected ? getMissingRequiredFields(selected, values) : [];
  const selectedStats = selected ? getWorkflowStats(selected.id, usage) : null;

  useEffect(() => {
    const refresh = () => setCustomWorkflows(loadCustomWorkflows());
    const initialCustomWorkflows = loadCustomWorkflows();
    setCustomWorkflows(initialCustomWorkflows);
    const requestedId = new URLSearchParams(window.location.search).get("workflow");
    const requestedWorkflow = [...initialCustomWorkflows, ...builtInWorkflows].find((workflow) => workflow.id === requestedId);
    if (requestedWorkflow) selectWorkflow(requestedWorkflow);
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
    if (!categories.includes(category)) setCategory("全部");
  }, [categories, category]);

  useEffect(() => {
    if (!selected || selected.id === selectedId) return;
    setSelectedId(selected.id);
    setValues(getInitialWorkflowValues(selected));
  }, [selected, selectedId]);

  useEffect(() => {
    if (!builderOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => {
      const firstInput = builderDialogRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), textarea:not([disabled]), select:not([disabled])'
      );
      (firstInput ?? builderDialogRef.current)?.focus();
    }, 0);
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setBuilderOpen(false);
        return;
      }
      if (event.key !== "Tab" || !builderDialogRef.current) return;
      const focusable = Array.from(
        builderDialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        builderDialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !builderDialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !builderDialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKeys);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleDialogKeys);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [builderOpen]);

  function selectWorkflow(workflow: WorkflowTemplate) {
    setSelectedId(workflow.id);
    setValues(getInitialWorkflowValues(workflow));
  }

  function changeTarget(nextTarget: WorkflowTarget | "all") {
    setTarget(nextTarget);
    setCategory("全部");
    const next = workflows.find((workflow) => nextTarget === "all" || workflow.target === nextTarget);
    if (next) selectWorkflow(next);
  }

  function changeCategory(nextCategory: string) {
    setCategory(nextCategory);
    const next = workflows.find(
      (workflow) =>
        (target === "all" || workflow.target === target) &&
        (nextCategory === "全部" || workflow.category === nextCategory)
    );
    if (next) selectWorkflow(next);
  }

  function launchWorkflow() {
    if (!selected) return;
    if (missingFields.length) {
      toast.error(`还需要填写：${missingFields.map((field) => field.label).join("、")}`);
      return;
    }
    const lengthError = getWorkflowPromptLengthError(selected.target, preview);
    if (lengthError) {
      toast.error(lengthError);
      return;
    }
    try {
      const workflowUrl = buildWorkflowUrl(selected, preview);
      setUsage(recordWorkflowUse(selected.id));
      router.push(workflowUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "工作流装载失败，请重试");
    }
  }

  function launchRuntime() {
    if (!selected) return;
    if (missingFields.length) {
      toast.error(`还需要填写：${missingFields.map((field) => field.label).join("、")}`);
      return;
    }
    const lengthError = getWorkflowPromptLengthError(selected.target, preview);
    if (lengthError) {
      toast.error(lengthError);
      return;
    }
    saveWorkflowRuntimeHandoff({
      version: 1,
      workflowId: selected.id,
      name: selected.name,
      prompt: preview,
      steps: selected.steps.map((step) => ({
        id: step.id,
        title: step.title,
        description: step.description
      })),
      target: selected.target,
      accent: selected.accent,
      createdAt: new Date().toISOString()
    });
    setUsage(recordWorkflowUse(selected.id));
    router.push(`/runs?workflow=${encodeURIComponent(selected.id)}`);
  }

  function toggleFavorite(workflow: WorkflowTemplate) {
    const wasFavorite = usage.favorites.includes(workflow.id);
    setUsage(toggleWorkflowFavorite(workflow.id));
    toast.success(wasFavorite ? "已取消收藏" : `已收藏「${workflow.name}」`);
  }

  async function copyPreview() {
    try {
      await navigator.clipboard.writeText(preview);
      toast.success("编译后的 Prompt 已复制");
    } catch {
      toast.error("无法访问剪贴板");
    }
  }

  function removeWorkflow(workflow: WorkflowTemplate) {
    if (!workflow.custom) return;
    if (!window.confirm(`删除自定义模板「${workflow.name}」？`)) return;
    const next = deleteCustomWorkflow(workflow.id);
    setCustomWorkflows(next);
    if (selectedId === workflow.id) selectWorkflow(builtInWorkflows[0]);
    toast.success("模板已删除");
  }

  function duplicateWorkflow(workflow: WorkflowTemplate) {
    const duplicate: WorkflowTemplate = {
      ...workflow,
      id: createCustomWorkflowId(),
      name: `${workflow.name} 副本`,
      fields: workflow.fields.map((field) => ({ ...field, options: field.options ? [...field.options] : undefined })),
      steps: workflow.steps.map((step, index) => ({ ...step, id: `${step.id || "step"}-${index + 1}` })),
      custom: true,
      createdAt: new Date().toISOString()
    };
    const next = saveCustomWorkflow(duplicate);
    setCustomWorkflows(next);
    setTarget(duplicate.target);
    setCategory("全部");
    setActivityFilter("all");
    selectWorkflow(duplicate);
    toast.success("已创建可编辑副本");
  }

  function exportWorkflowLibrary() {
    if (!customWorkflows.length) {
      toast.info("还没有可导出的自定义工作流");
      return;
    }
    const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), workflows: customWorkflows }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `aiweb-workflows-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`已导出 ${customWorkflows.length} 条自定义工作流`);
  }

  async function importWorkflowLibrary(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 1024 * 1024) {
      toast.error("工作流文件不能超过 1MB");
      return;
    }
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const source = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { workflows?: unknown }).workflows)
          ? (parsed as { workflows: unknown[] }).workflows
          : [];
      let imported = 0;
      let latest = loadCustomWorkflows();
      let firstImported: WorkflowTemplate | null = null;
      for (const raw of source.slice(0, 50)) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as Partial<WorkflowTemplate>;
        if (!item.name || !item.target || !Array.isArray(item.fields) || !Array.isArray(item.steps) || !item.promptTemplate) continue;
        const workflow: WorkflowTemplate = {
          ...item,
          id: createCustomWorkflowId(),
          name: String(item.name).slice(0, 80),
          category: String(item.category || "导入模板").slice(0, 40),
          description: String(item.description || "导入的自定义工作流").slice(0, 240),
          iconKey: "custom",
          accent: typeof item.accent === "string" ? item.accent : "#5B7CFF",
          target: item.target === "image" ? "image" : "chat",
          fields: item.fields,
          steps: item.steps,
          promptTemplate: String(item.promptTemplate),
          custom: true,
          createdAt: new Date().toISOString()
        };
        try {
          latest = saveCustomWorkflow(workflow);
          const normalizedWorkflow = latest.find((item) => item.id === workflow.id);
          if (!normalizedWorkflow) continue;
          firstImported ??= normalizedWorkflow;
          imported += 1;
        } catch {
          // Ignore malformed entries and continue importing valid workflows.
        }
      }
      if (!imported || !firstImported) throw new Error("文件中没有有效的工作流");
      setCustomWorkflows(latest);
      setTarget(firstImported.target);
      setCategory("全部");
      setActivityFilter("all");
      selectWorkflow(firstImported);
      toast.success(`已导入 ${imported} 条工作流`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法读取工作流文件");
    }
  }

  function openBuilder() {
    setDraft(cloneEmptyDraft());
    setBuilderOpen(true);
  }

  function addDraftField() {
    setDraft((current) => ({
      ...current,
      fields: [
        ...current.fields,
        {
          rowId: `field-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          key: `变量${current.fields.length + 1}`,
          label: `变量 ${current.fields.length + 1}`,
          type: "text",
          placeholder: "",
          required: false,
          optionsText: ""
        }
      ]
    }));
  }

  function updateDraftField(rowId: string, patch: Partial<DraftField>) {
    setDraft((current) => ({
      ...current,
      fields: current.fields.map((field) => (field.rowId === rowId ? { ...field, ...patch } : field))
    }));
  }

  function removeDraftField(rowId: string) {
    setDraft((current) => ({ ...current, fields: current.fields.filter((field) => field.rowId !== rowId) }));
  }

  function insertVariable(field: DraftField) {
    const token = `{{${fieldKeyFromLabel(field.key || field.label, 0)}}}`;
    setDraft((current) => ({ ...current, promptTemplate: `${current.promptTemplate}${current.promptTemplate ? "\n" : ""}${token}` }));
  }

  function saveDraft() {
    const name = draft.name.trim();
    const promptTemplate = draft.promptTemplate.trim();
    const validDraftFields = draft.fields.filter((field) => field.label.trim());
    if (!name || !promptTemplate) {
      toast.error("请填写模板名称和 Prompt 模板");
      return;
    }

    const emptySelect = validDraftFields.find(
      (field) => field.type === "select" && !field.optionsText.split(/[，,]/).some((item) => item.trim())
    );
    if (emptySelect) {
      toast.error(`请为「${emptySelect.label}」添加至少一个选项`);
      return;
    }

    const normalizedKeys = validDraftFields.map((field, index) => fieldKeyFromLabel(field.key || field.label, index));
    if (new Set(normalizedKeys).size !== normalizedKeys.length) {
      toast.error("变量键不能重复，请为每个变量设置唯一名称");
      return;
    }

    const fields: WorkflowField[] = validDraftFields.map((field, index) => {
      const key = normalizedKeys[index];
      return {
        key,
        label: field.label.trim(),
        type: field.type,
        placeholder: field.placeholder?.trim(),
        required: field.required,
        options: field.type === "select" ? field.optionsText.split(/[，,]/).map((item) => item.trim()).filter(Boolean) : undefined,
        defaultValue: field.type === "select" ? field.optionsText.split(/[，,]/).map((item) => item.trim()).filter(Boolean)[0] : undefined
      };
    });

    let normalizedPromptTemplate = promptTemplate;
    validDraftFields.forEach((field, index) => {
      const rawKey = field.key.trim();
      const normalizedKey = normalizedKeys[index];
      if (rawKey) {
        const escapedRawKey = rawKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        normalizedPromptTemplate = normalizedPromptTemplate.replace(
          new RegExp(`{{\\s*${escapedRawKey}\\s*}}`, "g"),
          `{{${normalizedKey}}}`
        );
      }
    });

    const steps = draft.stepsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const [title, ...description] = line.split("|");
        return {
          id: `step-${index + 1}`,
          title: title.trim() || `步骤 ${index + 1}`,
          description: description.join("|").trim() || "按当前目标完成此步骤"
        };
      });

    const workflow: WorkflowTemplate = {
      id: createCustomWorkflowId(),
      name,
      category: draft.category.trim() || "我的模板",
      description: draft.description.trim() || "自定义创作工作流",
      iconKey: "custom",
      accent: draft.accent,
      target: draft.target,
      fields,
      steps: steps.length ? steps : [{ id: "step-1", title: "执行任务", description: "理解变量并完成目标" }],
      promptTemplate: normalizedPromptTemplate,
      custom: true,
      createdAt: new Date().toISOString()
    };

    const next = saveCustomWorkflow(workflow);
    setCustomWorkflows(next);
    setTarget(workflow.target);
    setCategory("全部");
    selectWorkflow(workflow);
    setBuilderOpen(false);
    toast.success("自定义工作流已保存");
  }

  const SelectedIcon = selected ? iconMap[selected.iconKey] ?? Bot : Network;
  const selectedTargetLabel = selected?.target === "chat" ? "语言通道" : "视觉通道";

  return (
    <PageShell className="space-y-4 pb-8">
      <section className="relative overflow-hidden rounded-lg border border-border bg-[#0B0E15] text-white shadow-[0_30px_90px_rgba(5,8,16,0.24)]">
        <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#2DD4BF] to-transparent" />
        <div className="relative grid min-h-[238px] lg:grid-cols-[minmax(0,1fr)_410px]">
          <div className="flex flex-col justify-between p-6 sm:p-8">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase text-white/55">
                <span className="inline-flex items-center gap-2 rounded-sm bg-[#2DD4BF]/10 px-2 py-1 text-[#2DD4BF]">
                  <RadioTower className="h-3 w-3" /> Workflow fabric online
                </span>
                <span>LOCAL-FIRST TEMPLATE ENGINE</span>
              </div>
              <h2 className="mt-6 max-w-3xl text-3xl font-semibold leading-tight sm:text-4xl">把灵感编译成一条可重复的创作链路。</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/55">定义变量、组织步骤并实时检查最终指令。一次搭建，随时装载到对话或视觉工坊。</p>
            </div>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <button type="button" onClick={openBuilder} className="inline-flex h-10 items-center gap-2 rounded-md bg-[#5B7CFF] px-4 text-xs font-semibold text-white shadow-[0_10px_35px_rgba(91,124,255,.25)] transition hover:bg-[#6A88FF]">
                <Plus className="h-4 w-4" />创建工作流
              </button>
              <button type="button" onClick={() => importInputRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-white/[0.035] px-3 text-xs text-white/65 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-white" title="导入 JSON 工作流库">
                <Upload className="h-3.5 w-3.5" /><span className="hidden sm:inline">导入</span>
              </button>
              <button type="button" onClick={exportWorkflowLibrary} className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-white/[0.035] px-3 text-xs text-white/65 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-white" title="导出自定义工作流库">
                <Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">导出</span>
              </button>
              <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={importWorkflowLibrary} />
              <span className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-white/[0.035] px-3 text-xs text-white/60">
                <CheckCircle2 className="h-3.5 w-3.5 text-[#2DD4BF]" />{workflows.length} 条链路已挂载
              </span>
            </div>
          </div>
          <div className="relative hidden border-l border-white/10 p-6 lg:block">
            <div className="flex h-full flex-col justify-center">
              {["选择能力模板", "注入任务变量", "编译结构化 Prompt", "发送至创作通道"].map((label, index) => (
                <div key={label} className="relative flex items-center gap-3 py-2.5">
                  {index < 3 ? <span className="absolute left-[13px] top-[34px] h-5 w-px bg-gradient-to-b from-[#5B7CFF]/80 to-white/10" /> : null}
                  <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-md border text-[10px] font-bold", index === 3 ? "border-[#2DD4BF]/40 bg-[#2DD4BF]/10 text-[#2DD4BF]" : "border-[#5B7CFF]/35 bg-[#5B7CFF]/10 text-[#8EA2FF]")}>{String(index + 1).padStart(2, "0")}</span>
                  <span className="text-xs text-white/70">{label}</span>
                  {index === 3 ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#2DD4BF] shadow-[0_0_10px_#2DD4BF]" /> : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card/40 backdrop-blur-xl">
        <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div className="flex items-center gap-1 rounded-md border border-border bg-background/50 p-1" role="group" aria-label="按目标通道筛选">
            {(["all", "chat", "image"] as const).map((item) => {
              const Icon = item === "all" ? Network : item === "chat" ? MessageSquareText : ImageIcon;
              const label = item === "all" ? "全部" : item === "chat" ? "对话" : "生图";
              return (
                <button key={item} type="button" aria-pressed={target === item} onClick={() => changeTarget(item)} className={cn("flex h-8 flex-1 items-center justify-center gap-2 rounded-md px-3 text-[11px] font-medium transition sm:flex-none", target === item ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  <Icon className="h-3.5 w-3.5" />{label}
                </button>
              );
            })}
          </div>
          <label className="flex h-10 min-w-0 items-center gap-2 rounded-md border border-border bg-background/50 px-3 sm:w-[280px]">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索工作流、分类或用途" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60" />
            {query ? <button type="button" onClick={() => setQuery("")} aria-label="清空搜索"><X className="h-3.5 w-3.5 text-muted-foreground" /></button> : null}
          </label>
        </div>

        <div className="soft-scrollbar flex items-center gap-1 overflow-x-auto border-b border-border px-3 py-2 sm:px-4" role="group" aria-label="筛选工作流模板">
          {([
            ["all", "全部链路", Network],
            ["favorites", "已收藏", Star],
            ["recent", "最近", Clock3],
            ["popular", "常用", TrendingUp]
          ] as const).map(([value, label, Icon]) => (
            <button key={value} type="button" aria-pressed={activityFilter === value} onClick={() => setActivityFilter(value)} className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-medium transition", activityFilter === value ? "bg-foreground text-background" : "text-muted-foreground hover:bg-black/[0.03] hover:text-foreground dark:hover:bg-white/[0.04]")}>
              <Icon className="h-3 w-3" />{label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px shrink-0 bg-border" />
          {categories.map((item) => (
            <button key={item} type="button" aria-pressed={category === item} onClick={() => changeCategory(item)} className={cn("shrink-0 rounded-md px-2.5 py-1.5 text-[10px] font-medium transition", category === item ? "bg-[#5B7CFF]/12 text-[#6E88FF]" : "text-muted-foreground hover:bg-black/[0.03] hover:text-foreground dark:hover:bg-white/[0.04]")}>{item}</button>
          ))}
        </div>

        <div className="grid min-h-[680px] xl:h-[780px] xl:grid-cols-[330px_minmax(0,1fr)]">
          <aside className="soft-scrollbar max-h-[520px] overflow-y-auto border-b border-border p-2 sm:p-3 xl:max-h-full xl:border-b-0 xl:border-r">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1" role="group" aria-label="选择工作流模板">
              {filteredWorkflows.map((workflow) => {
                const Icon = iconMap[workflow.iconKey] ?? Bot;
                const active = selected?.id === workflow.id;
                return (
                  <button key={workflow.id} type="button" aria-pressed={active} onClick={() => selectWorkflow(workflow)} className={cn("group relative w-full overflow-hidden rounded-md border p-3 text-left transition", active ? "border-border bg-background shadow-sm" : "border-transparent hover:border-border hover:bg-background/55")}>
                    {active ? <span className="absolute inset-y-3 left-0 w-0.5 rounded-full" style={{ backgroundColor: workflow.accent, boxShadow: `0 0 12px ${workflow.accent}` }} /> : null}
                    <div className="flex items-start gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md" style={{ color: workflow.accent, backgroundColor: `${workflow.accent}17` }}><Icon className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-xs font-semibold">{workflow.name}</span>
                          {usage.favorites.includes(workflow.id) ? <Star className="h-3 w-3 shrink-0 fill-[#FBBF24] text-[#FBBF24]" /> : null}
                          {workflow.custom ? <span className="rounded-sm bg-[#A78BFA]/10 px-1 py-0.5 text-[8px] font-bold text-[#A78BFA]">MY</span> : null}
                        </span>
                        <span className="mt-1 line-clamp-2 block text-[10px] leading-4 text-muted-foreground">{workflow.description}</span>
                        <span className="mt-2 flex items-center gap-2 text-[9px] uppercase text-muted-foreground/70">
                          {workflow.target === "chat" ? <MessageSquareText className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                          {workflow.category} · {workflow.steps.length} STEPS{usage.useCounts[workflow.id] ? ` · ${usage.useCounts[workflow.id]} 次使用` : ""}
                        </span>
                      </span>
                      <ChevronRight className={cn("mt-2 h-3.5 w-3.5 shrink-0 transition", active ? "text-foreground" : "text-muted-foreground/40 group-hover:translate-x-0.5")} />
                    </div>
                  </button>
                );
              })}
            </div>
            {!filteredWorkflows.length ? (
              <div className="grid min-h-[220px] place-items-center text-center">
                <div><Search className="mx-auto h-5 w-5 text-muted-foreground/40" /><p className="mt-3 text-xs font-medium">未找到匹配工作流</p><button type="button" onClick={() => { setQuery(""); setCategory("全部"); setActivityFilter("all"); }} className="mt-2 text-[11px] text-[#5B7CFF]">重置筛选</button></div>
              </div>
            ) : null}
          </aside>

          {selected ? (
            <div className="grid min-w-0 lg:grid-cols-[minmax(300px,0.88fr)_minmax(360px,1.12fr)] xl:min-h-0">
              <section className="soft-scrollbar border-b border-border p-4 sm:p-5 lg:border-b-0 lg:border-r xl:min-h-0 xl:overflow-y-auto">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md" style={{ color: selected.accent, backgroundColor: `${selected.accent}18` }}><SelectedIcon className="h-[18px] w-[18px]" /></span>
                    <div className="min-w-0"><h3 className="truncate text-base font-semibold">{selected.name}</h3><p className="mt-0.5 text-[10px] text-muted-foreground">{selectedTargetLabel} · {selected.category}</p></div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => toggleFavorite(selected)} aria-label={selectedStats?.favorite ? "取消收藏" : "收藏工作流"} aria-pressed={Boolean(selectedStats?.favorite)} title={selectedStats?.favorite ? "取消收藏" : "收藏"} className={cn("grid h-8 w-8 place-items-center rounded-md transition hover:bg-[#FBBF24]/10", selectedStats?.favorite ? "text-[#FBBF24]" : "text-muted-foreground hover:text-[#FBBF24]")}><Star className={cn("h-3.5 w-3.5", selectedStats?.favorite && "fill-current")} /></button>
                    <button type="button" onClick={() => duplicateWorkflow(selected)} aria-label="创建工作流副本" title="创建可编辑副本" className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition hover:bg-[#5B7CFF]/10 hover:text-[#5B7CFF]"><Files className="h-3.5 w-3.5" /></button>
                    {selected.custom ? <button type="button" onClick={() => removeWorkflow(selected)} aria-label="删除模板" title="删除" className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition hover:bg-red-500/10 hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button> : null}
                  </div>
                </div>

                <p className="mt-3 text-[11px] leading-5 text-muted-foreground">{selected.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[9px] text-muted-foreground">
                  <span className="rounded-sm border border-border px-1.5 py-1">{selected.fields.length} INPUTS</span>
                  <span className="rounded-sm border border-border px-1.5 py-1">{selected.steps.length} NODES</span>
                  <span className="rounded-sm border border-border px-1.5 py-1">{selectedStats?.useCount ?? 0} 次装载</span>
                  {selectedStats?.lastUsedAt ? <span className="rounded-sm border border-[#2DD4BF]/20 bg-[#2DD4BF]/5 px-1.5 py-1 text-[#14B8A6]">RECENT SIGNAL</span> : null}
                </div>

                <div className="mt-5 border-t border-border pt-5">
                  <div className="flex items-center justify-between gap-3"><span className="text-[9px] font-bold uppercase text-muted-foreground">EXECUTION GRAPH</span><span className="text-[9px] text-muted-foreground">{selected.steps.length} NODES</span></div>
                  <div className="mt-3">
                    {selected.steps.map((step, index) => (
                      <div key={step.id} className="relative flex gap-3 pb-4 last:pb-0">
                        {index < selected.steps.length - 1 ? <span className="absolute left-[13px] top-7 h-[calc(100%-12px)] w-px bg-border" /> : null}
                        <span className="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border bg-background text-[9px] font-bold" style={{ color: selected.accent }}>{String(index + 1).padStart(2, "0")}</span>
                        <div className="pt-0.5"><p className="text-[11px] font-semibold">{step.title}</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{step.description}</p></div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 border-t border-border pt-5">
                  <div className="mb-4 flex items-center justify-between gap-3"><span className="text-[9px] font-bold uppercase text-muted-foreground">VARIABLE INPUT</span><span className="text-[9px] text-muted-foreground">{selected.fields.length} FIELDS</span></div>
                  <div className="space-y-4">
                    {selected.fields.map((field) => (
                      <label key={field.key} className="block">
                        <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium">{field.label}{field.required ? <span className="text-[#FB7185]">*</span> : <span className="text-[9px] font-normal text-muted-foreground">可选</span>}</span>
                        {field.type === "textarea" ? (
                          <textarea required={field.required} aria-required={field.required} value={values[field.key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} placeholder={field.placeholder} rows={3} className="w-full resize-y rounded-md border border-border bg-background/55 px-3 py-2.5 text-xs leading-5 outline-none transition placeholder:text-muted-foreground/50 focus-visible:border-[#5B7CFF]/70 focus-visible:ring-2 focus-visible:ring-[#5B7CFF]/30" />
                        ) : field.type === "select" ? (
                          <select required={field.required} aria-required={field.required} value={values[field.key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} className="h-10 w-full rounded-md border border-border bg-background/55 px-3 text-xs outline-none transition focus-visible:border-[#5B7CFF]/70 focus-visible:ring-2 focus-visible:ring-[#5B7CFF]/30">
                            {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        ) : (
                          <input required={field.required} aria-required={field.required} value={values[field.key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} placeholder={field.placeholder} className="h-10 w-full rounded-md border border-border bg-background/55 px-3 text-xs outline-none transition placeholder:text-muted-foreground/50 focus-visible:border-[#5B7CFF]/70 focus-visible:ring-2 focus-visible:ring-[#5B7CFF]/30" />
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              </section>

              <section className="flex min-h-[560px] flex-col overflow-hidden bg-[#0B0E15] text-white xl:min-h-0">
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
                  <span className="flex items-center gap-2 text-[10px] font-semibold uppercase text-white/55"><CircleDotDashed className="h-3.5 w-3.5 text-[#2DD4BF]" />Compiled prompt</span>
                  <button type="button" onClick={copyPreview} className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-[10px] text-white/50 transition hover:bg-white/10 hover:text-white"><Copy className="h-3.5 w-3.5" />复制</button>
                </div>
                <pre className="soft-scrollbar min-h-[360px] flex-1 overflow-y-auto whitespace-pre-wrap break-words p-4 font-mono text-[11px] leading-6 text-white/70 sm:p-5">{preview}</pre>
                <div className="border-t border-white/10 p-4 sm:p-5">
                  <div className="mb-3 flex items-center justify-between gap-3 text-[9px] uppercase text-white/40"><span>{preview.length.toLocaleString("zh-CN")} characters</span><span className={missingFields.length ? "text-[#FB7185]" : "text-[#2DD4BF]"}>{missingFields.length ? `${missingFields.length} required` : "prompt ready"}</span></div>
                  <div className="grid gap-2 sm:grid-cols-[1.15fr_.85fr]">
                    <button type="button" onClick={launchRuntime} className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#38BDF8] text-sm font-semibold text-[#071018] shadow-[0_12px_35px_rgba(56,189,248,.22)] transition hover:bg-[#67CCF5]">
                      在执行台运行<Rocket className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={launchWorkflow} className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-white/12 bg-white/[0.045] text-xs font-semibold text-white/70 transition hover:bg-white/[0.09] hover:text-white">
                      直接发送至{selected.target === "chat" ? "对话" : "生图"}<ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </section>

      {builderOpen ? createPortal((
        <div className="fixed inset-0 z-[85] flex items-end justify-center bg-[#070910]/75 backdrop-blur-md sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && setBuilderOpen(false)}>
          <div ref={builderDialogRef} role="dialog" aria-modal="true" aria-label="创建工作流" tabIndex={-1} className="relative flex h-[96dvh] w-full max-w-[1100px] flex-col overflow-hidden rounded-t-lg border border-white/10 bg-background shadow-[0_30px_120px_rgba(0,0,0,.6)] sm:h-[min(800px,90vh)] sm:rounded-lg">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#A78BFA] to-transparent" />
            <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 sm:px-5">
              <div><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-[#A78BFA]" /><h2 className="text-sm font-semibold">工作流构建器</h2><span className="rounded-sm bg-[#A78BFA]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#A78BFA]">LOCAL</span></div><p className="mt-1 text-[10px] text-muted-foreground">模板只保存在当前浏览器中</p></div>
              <button type="button" onClick={() => setBuilderOpen(false)} aria-label="关闭构建器" className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]"><X className="h-4 w-4" /></button>
            </header>

            <div className="soft-scrollbar min-h-0 flex-1 overflow-y-auto">
              <div className="grid lg:grid-cols-[minmax(0,0.88fr)_minmax(380px,1.12fr)]">
                <section className="border-b border-border p-4 sm:p-5 lg:border-b-0 lg:border-r">
                  <p className="text-[9px] font-bold uppercase text-muted-foreground">01 / IDENTITY</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <BuilderInput label="模板名称" required value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} placeholder="例如：品牌周报生成器" />
                    <BuilderInput label="分类" value={draft.category} onChange={(value) => setDraft((current) => ({ ...current, category: value }))} placeholder="我的模板" />
                  </div>
                  <label className="mt-4 block"><span className="mb-1.5 block text-[11px] font-medium">用途描述</span><textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} rows={2} placeholder="这个工作流会完成什么任务？" className="w-full resize-y rounded-md border border-border bg-card/40 px-3 py-2.5 text-xs outline-none placeholder:text-muted-foreground/50 focus-visible:border-[#5B7CFF]/70 focus-visible:ring-2 focus-visible:ring-[#5B7CFF]/30" /></label>
                  <div className="mt-4"><span className="mb-1.5 block text-[11px] font-medium">目标通道</span><div className="grid grid-cols-2 gap-2" role="group" aria-label="工作流目标通道">{(["chat", "image"] as const).map((item) => <button key={item} type="button" aria-pressed={draft.target === item} onClick={() => setDraft((current) => ({ ...current, target: item }))} className={cn("flex h-10 items-center justify-center gap-2 rounded-md border text-xs font-medium transition", draft.target === item ? "border-[#5B7CFF]/50 bg-[#5B7CFF]/10 text-[#6D87FF]" : "border-border text-muted-foreground hover:text-foreground")}>{item === "chat" ? <MessageSquareText className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}{item === "chat" ? "AI 对话" : "视觉工坊"}</button>)}</div></div>
                  <div className="mt-4"><span className="mb-2 block text-[11px] font-medium">信号色</span><div className="flex flex-wrap gap-2" role="group" aria-label="工作流信号色">{accentOptions.map((accent) => <button key={accent} type="button" onClick={() => setDraft((current) => ({ ...current, accent }))} aria-label={`选择颜色 ${accent}`} aria-pressed={draft.accent === accent} className={cn("h-7 w-7 rounded-md border-2 transition", draft.accent === accent ? "scale-110 border-foreground" : "border-transparent opacity-65 hover:opacity-100")} style={{ backgroundColor: accent }} />)}</div></div>

                  <div className="mt-7 flex items-center justify-between"><p className="text-[9px] font-bold uppercase text-muted-foreground">02 / VARIABLES</p><button type="button" onClick={addDraftField} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[#5B7CFF]/10 px-2 text-[10px] font-semibold text-[#6D87FF]"><Plus className="h-3 w-3" />添加变量</button></div>
                  <div className="mt-3 divide-y divide-border border-y border-border">
                    {draft.fields.map((field, index) => (
                      <div key={field.rowId} className="py-4">
                        <div className="flex items-center justify-between"><span className="text-[10px] font-semibold text-muted-foreground">VARIABLE {String(index + 1).padStart(2, "0")}</span><div className="flex items-center gap-1"><button type="button" onClick={() => insertVariable(field)} className="rounded-md px-2 py-1 text-[9px] font-medium text-[#5B7CFF] hover:bg-[#5B7CFF]/10">插入模板</button><button type="button" onClick={() => removeDraftField(field.rowId)} aria-label="删除变量" className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-red-500/10 hover:text-red-400"><Trash2 className="h-3 w-3" /></button></div></div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2"><BuilderInput label="显示名称" value={field.label} onChange={(value) => updateDraftField(field.rowId, { label: value })} placeholder="主题" /><BuilderInput label="变量键" value={field.key} onChange={(value) => updateDraftField(field.rowId, { key: value })} placeholder="topic" /></div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2"><label><span className="mb-1.5 block text-[10px] text-muted-foreground">字段类型</span><select value={field.type} onChange={(event) => updateDraftField(field.rowId, { type: event.target.value as WorkflowFieldType })} className="h-9 w-full rounded-md border border-border bg-card/40 px-2.5 text-xs outline-none transition focus-visible:border-[#5B7CFF]/70 focus-visible:ring-2 focus-visible:ring-[#5B7CFF]/30"><option value="text">单行文本</option><option value="textarea">多行文本</option><option value="select">选项菜单</option></select></label><BuilderInput label={field.type === "select" ? "选项（逗号分隔）" : "占位提示"} value={field.type === "select" ? field.optionsText : field.placeholder ?? ""} onChange={(value) => updateDraftField(field.rowId, field.type === "select" ? { optionsText: value } : { placeholder: value })} /></div>
                        <label className="mt-3 inline-flex items-center gap-2 text-[10px] text-muted-foreground"><input type="checkbox" checked={Boolean(field.required)} onChange={(event) => updateDraftField(field.rowId, { required: event.target.checked })} className="h-3.5 w-3.5 accent-[#5B7CFF]" />设为必填变量</label>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="p-4 sm:p-5">
                  <p className="text-[9px] font-bold uppercase text-muted-foreground">03 / EXECUTION GRAPH</p>
                  <label className="mt-4 block"><span className="mb-1.5 flex items-center justify-between text-[11px] font-medium"><span>执行步骤</span><span className="text-[9px] font-normal text-muted-foreground">每行：标题 | 说明</span></span><textarea value={draft.stepsText} onChange={(event) => setDraft((current) => ({ ...current, stepsText: event.target.value }))} rows={5} className="w-full resize-y rounded-md border border-border bg-card/40 px-3 py-2.5 font-mono text-[11px] leading-5 outline-none transition focus-visible:border-[#5B7CFF]/70 focus-visible:ring-2 focus-visible:ring-[#5B7CFF]/30" /></label>

                  <p className="mt-7 text-[9px] font-bold uppercase text-muted-foreground">04 / PROMPT SOURCE</p>
                  <div className="mt-4 overflow-hidden rounded-md border border-white/10 bg-[#0B0E15]">
                    <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-[9px] uppercase text-white/45"><span>Template source</span><span>{draft.promptTemplate.length} chars</span></div>
                    <textarea required aria-required="true" value={draft.promptTemplate} onChange={(event) => setDraft((current) => ({ ...current, promptTemplate: event.target.value }))} rows={16} placeholder="使用 {{变量键}} 将表单输入注入 Prompt" className="soft-scrollbar w-full resize-y bg-transparent p-3 font-mono text-[11px] leading-6 text-white/75 outline-none placeholder:text-white/25 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5B7CFF]/70" />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">{draft.fields.map((field) => <button key={field.rowId} type="button" onClick={() => insertVariable(field)} className="rounded-md border border-border px-2 py-1 font-mono text-[9px] text-muted-foreground transition hover:border-[#5B7CFF]/45 hover:text-[#5B7CFF]">{`{{${field.key || "variable"}}}`}</button>)}</div>
                </section>
              </div>
            </div>
            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-card/60 px-4 py-3 sm:px-5"><span className="hidden text-[10px] text-muted-foreground sm:block">保存后可在工作流中心、对话和视觉工坊中调用</span><div className="ml-auto flex gap-2"><button type="button" onClick={() => setBuilderOpen(false)} className="h-9 rounded-md px-3 text-xs font-medium text-muted-foreground hover:text-foreground">取消</button><button type="button" onClick={saveDraft} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#5B7CFF] px-4 text-xs font-semibold text-white"><Sparkles className="h-3.5 w-3.5" />保存并装载</button></div></footer>
          </div>
        </div>
      ), document.body) : null}
    </PageShell>
  );
}

function BuilderInput({ label, value, onChange, placeholder, required = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean }) {
  return <label className="block"><span className="mb-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">{label}{required ? <span className="text-[#FB7185]">*</span> : null}</span><input required={required} aria-required={required} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-9 w-full rounded-md border border-border bg-card/40 px-2.5 text-xs outline-none transition placeholder:text-muted-foreground/45 focus-visible:border-[#5B7CFF]/70 focus-visible:ring-2 focus-visible:ring-[#5B7CFF]/30" /></label>;
}
