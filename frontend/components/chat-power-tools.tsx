"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useReducedMotion } from "framer-motion";
import {
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  CirclePlus,
  Coins,
  FileOutput,
  GitBranch,
  Image as ImageIcon,
  Layers3,
  ListChecks,
  Loader2,
  Merge,
  Presentation,
  Share2,
  Sparkles,
  Swords,
  Timer,
  Trash2,
  Trophy,
  WandSparkles,
  Workflow,
  X
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  compareArena,
  getStoredUser,
  type ArenaContestant,
  type ArenaResult,
  type ChatModel,
  type Provider
} from "@/lib/api";
import {
  buildAnswerTransformPrompt,
  buildArenaMergePrompt,
  buildBranchContextPrompt,
  buildVisualBrief,
  createChatBranch,
  deleteChatBranch,
  readChatBranches,
  seedPromptFromText,
  type AnswerTransformKind,
  type ChatBranch,
  type ChatPowerMessage
} from "@/lib/chat-power";
import { cn } from "@/lib/utils";
import { queueArtifactCreation } from "@/lib/studio";

const BRANCH_REQUEST_EVENT = "aiweb:chat-branch-request";
const PENDING_PROMPT_KEY = "aiweb:pending-prompt";

type DialogMode = "arena" | "duel" | "branches";
type ContestantDraft = ArenaContestant & { label: string };

const DUEL_ROLES = [
  {
    label: "务实派",
    role: "务实的交付负责人：优先考虑可执行性、成本、依赖、风险和可验证的近期收益，给出可以立即开始的方案。"
  },
  {
    label: "跃迁派",
    role: "大胆但严谨的创新策略师：主动寻找非线性机会、跨领域组合和能显著抬高上限的方案，同时标清关键假设。"
  },
  {
    label: "反方",
    role: "建设性的反方评审：挑战隐含假设，寻找失败模式、二阶影响和被忽略的替代路径，并提出更强的修正方案。"
  }
] as const;

const answerActions: Array<{
  kind: Exclude<AnswerTransformKind, "visual">;
  label: string;
  description: string;
  icon: typeof ListChecks;
}> = [
  { kind: "tasks", label: "任务清单", description: "阶段、负责人和验收标准", icon: ListChecks },
  { kind: "workflow", label: "工作流草案", description: "变量、节点、分支和测试", icon: Workflow },
  { kind: "infographic", label: "信息图结构", description: "内容层级与视觉编码", icon: ChartNoAxesCombined },
  { kind: "slides", label: "演示稿大纲", description: "8-12 页叙事结构", icon: Presentation },
  { kind: "social", label: "社媒内容包", description: "长帖、短帖与标题", icon: Share2 }
];

function cleanArenaAnswer(content: string): string {
  const answer = content.match(/<ai_answer>\s*([\s\S]*?)\s*<\/ai_answer>/i)?.[1];
  if (answer) return answer.trim();
  return content.replace(/<ai_thought_summary>[\s\S]*?<\/ai_thought_summary>/gi, "").trim();
}

function candidateName(index: number): string {
  return `候选 ${String.fromCharCode(65 + index)}`;
}

function branchDepth(branch: ChatBranch, byId: Map<string, ChatBranch>): number {
  let depth = 0;
  let parentId = branch.parentId;
  const visited = new Set<string>();
  while (parentId && depth < 4 && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    depth += 1;
    parentId = parent.parentId;
  }
  return depth;
}

export function MessageBranchButton({
  messageIndex,
  disabled = false,
  className
}: {
  messageIndex: number;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-8 w-8 rounded-lg", className)}
      disabled={disabled}
      onClick={() => window.dispatchEvent(new CustomEvent(BRANCH_REQUEST_EVENT, { detail: { messageIndex } }))}
      aria-label="从此消息创建分支"
      title="从此消息创建本地分支"
    >
      <GitBranch className="h-3.5 w-3.5" />
    </Button>
  );
}

export function AnswerActionBar({
  answer,
  onInsertPrompt
}: {
  answer: string;
  onInsertPrompt: (prompt: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 8, top: 48, width: 304 });
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const placeMenu = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportPadding = 8;
      const width = Math.min(304, window.innerWidth - viewportPadding * 2);
      const estimatedHeight = 300;
      const roomBelow = window.innerHeight - rect.bottom;
      const top = roomBelow >= estimatedHeight + viewportPadding
        ? rect.bottom + 8
        : Math.max(viewportPadding, rect.top - estimatedHeight - 8);
      const left = Math.min(
        window.innerWidth - width - viewportPadding,
        Math.max(viewportPadding, rect.right - width)
      );
      setMenuPosition({ left, top, width });
    };
    placeMenu();
    const frame = window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const outside = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node) || triggerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", placeMenu, true);
    window.addEventListener("resize", placeMenu);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", placeMenu, true);
      window.removeEventListener("resize", placeMenu);
    };
  }, [open]);

  function insert(kind: Exclude<AnswerTransformKind, "visual">) {
    try {
      onInsertPrompt(buildAnswerTransformPrompt(kind, answer));
      setOpen(false);
      toast.success("结构化指令已装入输入区。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法生成转换指令。");
    }
  }

  function sendToImage() {
    try {
      const prompt = buildVisualBrief(answer);
      sessionStorage.setItem(PENDING_PROMPT_KEY, JSON.stringify({ prompt, target: "image", source: "chat-answer" }));
      setOpen(false);
      router.push("/image");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法生成视觉 Brief。");
    }
  }

  function createArtifact() {
    const content = cleanArenaAnswer(answer);
    queueArtifactCreation({
      type: "document",
      title: content.split(/\n+/)[0]?.replace(/^#+\s*/, "").slice(0, 80) || "聊天产物",
      content,
      source: "chat-answer"
    });
    setOpen(false);
    router.push("/studio");
    toast.success("回答已发送到 Artifact 画布。");
  }

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-lg"
        onClick={() => setOpen((current) => !current)}
        aria-label="打开回答变形器"
        aria-haspopup="menu"
        aria-expanded={open}
        title="智能后续动作"
      >
        <WandSparkles className="h-3.5 w-3.5" />
      </Button>
      {open && typeof document !== "undefined" ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="回答变形器"
          style={menuPosition}
          className="fixed z-[100] max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-lg border border-[#5B7CFF]/30 bg-background/95 p-2 text-left shadow-[0_22px_70px_rgba(0,0,0,.32)] backdrop-blur-xl"
        >
          <div className="mb-2 flex items-center gap-2 border-b border-border px-2 pb-2">
            <Sparkles className="h-3.5 w-3.5 text-[#2DD4BF]" />
            <div>
              <p className="text-xs font-semibold">回答变形器</p>
              <p className="text-[10px] text-muted-foreground">把当前答案变成下一项可交付成果</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {answerActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.kind}
                  type="button"
                  role="menuitem"
                  onClick={() => insert(action.kind)}
                  className="flex min-w-0 items-start gap-2 rounded-md px-2.5 py-2 text-left transition hover:bg-[#5B7CFF]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B7CFF]"
                >
                  <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#5B7CFF]" />
                  <span className="min-w-0">
                    <span className="block text-[11px] font-semibold">{action.label}</span>
                    <span className="block text-[9px] leading-4 text-muted-foreground">{action.description}</span>
                  </span>
                </button>
              );
            })}
            <button type="button" role="menuitem" onClick={sendToImage} className="flex items-start gap-2 rounded-md px-2.5 py-2 text-left transition hover:bg-[#2DD4BF]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2DD4BF]">
              <ImageIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#2DD4BF]" />
              <span><span className="block text-[11px] font-semibold">视觉 Brief</span><span className="block text-[9px] leading-4 text-muted-foreground">送往视觉工坊</span></span>
            </button>
            <button type="button" role="menuitem" onClick={createArtifact} className="flex items-start gap-2 rounded-md px-2.5 py-2 text-left transition hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
              <FileOutput className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span><span className="block text-[11px] font-semibold">Artifact</span><span className="block text-[9px] leading-4 text-muted-foreground">进入创作画布</span></span>
            </button>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}

export function ChatPowerTools({
  messages,
  models,
  activeSessionId,
  provider,
  model,
  composerText,
  disabled,
  onInsertPrompt
}: {
  messages: ChatPowerMessage[];
  models: ChatModel[];
  activeSessionId: number | null;
  provider: Provider;
  model: string;
  composerText: string;
  disabled?: boolean;
  onInsertPrompt: (prompt: string) => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const runningRef = useRef(false);
  const [dialog, setDialog] = useState<DialogMode | null>(null);
  const [prompt, setPrompt] = useState("");
  const [contestants, setContestants] = useState<ContestantDraft[]>([]);
  const [blind, setBlind] = useState(true);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ArenaResult[]>([]);
  const [winner, setWinner] = useState<number | null>(null);
  const [branches, setBranches] = useState<ChatBranch[]>([]);
  const [branchSourceIndex, setBranchSourceIndex] = useState<number | null>(null);
  const [branchName, setBranchName] = useState("");
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const userId = getStoredUser()?.id ?? null;

  useEffect(() => {
    setActiveBranchId(null);
    setBranchSourceIndex(null);
    setDialog((current) => current === "branches" ? null : current);
  }, [activeSessionId, userId]);

  const modelByProvider = useMemo(
    () => ({
      openai: models.filter((item) => item.provider === "openai"),
      grok: models.filter((item) => item.provider === "grok")
    }),
    [models]
  );
  const branchById = useMemo(() => new Map(branches.map((branch) => [branch.id, branch])), [branches]);
  const orderedBranches = useMemo(() => {
    const children = new Map<string, ChatBranch[]>();
    for (const branch of branches) {
      if (!branch.parentId) continue;
      children.set(branch.parentId, [...(children.get(branch.parentId) ?? []), branch]);
    }
    const ordered: ChatBranch[] = [];
    const visited = new Set<string>();
    const visit = (branch: ChatBranch) => {
      if (visited.has(branch.id)) return;
      visited.add(branch.id);
      ordered.push(branch);
      for (const child of children.get(branch.id) ?? []) visit(child);
    };
    for (const branch of branches) {
      if (!branch.parentId || !branchById.has(branch.parentId)) visit(branch);
    }
    for (const branch of branches) visit(branch);
    return ordered;
  }, [branchById, branches]);

  function defaultModel(targetProvider: Provider): string {
    const list = modelByProvider[targetProvider];
    if (targetProvider === provider && list.some((item) => item.model_id === model)) return model;
    return list.find((item) => item.is_default)?.model_id ?? list[0]?.model_id ?? "";
  }

  function promptSeed(): string {
    const recentUser = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const recentAssistant = [...messages].reverse().find((message) => message.role === "assistant")?.content ?? "";
    return seedPromptFromText(composerText.trim() || recentUser.trim() || cleanArenaAnswer(recentAssistant));
  }

  function rememberFocus() {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  function openArena(mode: "arena" | "duel") {
    rememberFocus();
    const seed = promptSeed();
    const baseProvider = modelByProvider[provider].length ? provider : modelByProvider.openai.length ? "openai" : "grok";
    if (mode === "duel") {
      setContestants(
        DUEL_ROLES.map((preset) => ({
          provider: baseProvider,
          model: defaultModel(baseProvider),
          label: preset.label,
          role: preset.role
        }))
      );
    } else {
      const secondProvider: Provider = baseProvider === "openai" && modelByProvider.grok.length ? "grok" : baseProvider === "grok" && modelByProvider.openai.length ? "openai" : baseProvider;
      setContestants([
        { provider: baseProvider, model: defaultModel(baseProvider), label: "候选 A", role: "" },
        { provider: secondProvider, model: defaultModel(secondProvider), label: "候选 B", role: "" }
      ]);
    }
    setPrompt(seed);
    setResults([]);
    setWinner(null);
    setBlind(true);
    setDialog(mode);
  }

  function openBranches(sourceIndex: number | null = null) {
    rememberFocus();
    setBranches(readChatBranches(userId));
    setBranchSourceIndex(sourceIndex);
    const source = sourceIndex === null ? "" : cleanArenaAnswer(messages[sourceIndex]?.content ?? "");
    setBranchName(source.split(/\n+/)[0]?.replace(/^#+\s*/, "").slice(0, 48) || "新的探索分支");
    setDialog("branches");
  }

  useEffect(() => {
    const requestBranch = (event: Event) => {
      const index = Number((event as CustomEvent<{ messageIndex?: unknown }>).detail?.messageIndex);
      if (!Number.isSafeInteger(index) || index < 0 || index >= messages.length) return;
      openBranches(index);
    };
    window.addEventListener(BRANCH_REQUEST_EVENT, requestBranch);
    return () => window.removeEventListener(BRANCH_REQUEST_EVENT, requestBranch);
  });

  useEffect(() => {
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('textarea, input, button:not([disabled]), [tabindex]:not([tabindex="-1"])')?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !runningRef.current) {
        event.preventDefault();
        setDialog(null);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
      ).filter((item) => item.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
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
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [dialog]);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  function updateContestant(index: number, patch: Partial<ContestantDraft>) {
    setContestants((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  async function runArena() {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) return toast.error("请输入要对比的任务。");
    if (normalizedPrompt.length > 4000) return toast.error("竞技场任务不能超过 4000 个字符。");
    if (contestants.some((item) => !item.model)) return toast.error("每位候选都需要选择一个可用模型。");
    runningRef.current = true;
    setRunning(true);
    setResults([]);
    setWinner(null);
    try {
      const response = await compareArena(
        normalizedPrompt,
        contestants.map(({ provider: itemProvider, model: itemModel, role }) => ({ provider: itemProvider, model: itemModel, role }))
      );
      setResults([...response.results].sort((a, b) => a.contestant_index - b.contestant_index));
      const successCount = response.results.filter((item) => !item.error && item.text.trim()).length;
      if (!successCount) toast.error("本轮所有候选均未返回有效结果。");
      else if (successCount < response.results.length) toast.warning("部分候选失败，成功结果已保留。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "竞技场执行失败，请稍后重试。");
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  function mergeResults() {
    try {
      const cleaned = results.map((result) => ({ ...result, text: cleanArenaAnswer(result.text) }));
      onInsertPrompt(buildArenaMergePrompt(cleaned));
      setDialog(null);
      toast.success("融合指令已装入聊天输入区。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "暂时无法合并结果。");
    }
  }

  function insertWinner() {
    const result = results.find((item) => item.contestant_index === winner);
    if (!result?.text || result.error) return;
    onInsertPrompt(seedPromptFromText(cleanArenaAnswer(result.text)));
    setDialog(null);
    toast.success("胜出回答已装入输入区。");
  }

  function saveBranch() {
    if (!userId) return toast.error("请重新登录后再保存分支。");
    if (branchSourceIndex === null) return;
    try {
      const branch = createChatBranch({
        userId,
        name: branchName,
        messages,
        throughIndex: branchSourceIndex,
        sourceSessionId: activeSessionId,
        parentId: activeBranchId
      });
      setBranches(readChatBranches(userId));
      setActiveBranchId(branch.id);
      setBranchSourceIndex(null);
      toast.success("本地分支快照已创建。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分支保存失败。");
    }
  }

  function loadBranch(branch: ChatBranch) {
    try {
      onInsertPrompt(buildBranchContextPrompt(branch));
      setActiveBranchId(branch.id);
      setDialog(null);
      toast.success("分支上下文已装入输入区，服务端历史保持不变。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法载入分支。");
    }
  }

  function removeBranch(branch: ChatBranch) {
    if (!userId) return;
    if (!window.confirm(`删除「${branch.name}」及其子分支吗？此操作无法恢复。`)) return;
    try {
      setBranches(deleteChatBranch(userId, branch.id));
      if (activeBranchId === branch.id) setActiveBranchId(null);
      toast.success("分支已删除。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分支删除失败。");
    }
  }

  return (
    <>
      <div className="flex items-center gap-1">
        <Button type="button" variant="secondary" size="sm" disabled={disabled || models.length === 0} onClick={() => openArena("arena")} title="让 2-3 个模型并行回答并盲评">
          <Swords className="h-3.5 w-3.5" /><span className="hidden 2xl:inline">竞技场</span>
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={disabled || models.length === 0} onClick={() => openArena("duel")} title="务实派、跃迁派与反方并行思考">
          <Sparkles className="h-3.5 w-3.5" /><span className="hidden 2xl:inline">创意对决</span>
        </Button>
        <Button type="button" variant="secondary" size="icon" className="h-9 w-9" disabled={disabled} onClick={() => openBranches()} aria-label="管理对话分支" title="本地分支树">
          <GitBranch className="h-3.5 w-3.5" />
        </Button>
      </div>

      {dialog && typeof document !== "undefined" ? createPortal(
        <div
          className={cn("fixed inset-0 z-[90] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4", !shouldReduceMotion && "animate-in fade-in duration-150")}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !running) setDialog(null);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={dialog === "branches" ? "对话分支" : dialog === "duel" ? "创意对决" : "模型竞技场"}
            tabIndex={-1}
            className="relative flex h-[96dvh] w-full max-w-[1380px] flex-col overflow-hidden rounded-t-lg border border-white/10 bg-background shadow-[0_32px_120px_rgba(0,0,0,.65)] sm:h-[min(860px,92dvh)] sm:rounded-lg"
          >
            <div className="relative flex shrink-0 items-center justify-between gap-3 overflow-hidden border-b border-border px-4 py-3 sm:px-5">
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#2DD4BF]/80 to-transparent" />
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[#5B7CFF]/30 bg-[#5B7CFF]/10 text-[#5B7CFF]">
                  {dialog === "branches" ? <GitBranch className="h-4 w-4" /> : dialog === "duel" ? <Sparkles className="h-4 w-4" /> : <Swords className="h-4 w-4" />}
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold sm:text-base">{dialog === "branches" ? "本地分支树" : dialog === "duel" ? "创意对决" : "模型竞技场"}</h2>
                  <p className="truncate text-[10px] text-muted-foreground sm:text-xs">{dialog === "branches" ? "快照仅保存在当前账号浏览器，不改写服务端会话" : "多路并发 · 真实结果 · 可盲评"}</p>
                </div>
              </div>
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" disabled={running} onClick={() => setDialog(null)} aria-label="关闭" title="关闭">
                <X className="h-4 w-4" />
              </Button>
            </div>

            {dialog === "branches" ? (
              <div className="soft-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5">
                {branchSourceIndex !== null ? (
                  <div className="mb-5 border-l-2 border-[#2DD4BF] bg-[#2DD4BF]/5 px-4 py-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <label className="min-w-0 flex-1 text-xs font-medium">分支名称
                        <input value={branchName} maxLength={80} onChange={(event) => setBranchName(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-border bg-background/80 px-3 text-sm outline-none focus:border-[#2DD4BF] focus:ring-2 focus:ring-[#2DD4BF]/15" />
                      </label>
                      <div className="flex gap-2">
                        <Button type="button" variant="secondary" size="sm" onClick={() => setBranchSourceIndex(null)}>取消</Button>
                        <Button type="button" size="sm" onClick={saveBranch}><GitBranch className="h-3.5 w-3.5" />保存快照</Button>
                      </div>
                    </div>
                    <p className="mt-2 text-[10px] text-muted-foreground">快照截止到第 {branchSourceIndex + 1} 条消息{activeBranchId ? "，并挂载到当前本地分支" : ""}。</p>
                  </div>
                ) : messages.length ? (
                  <div className="mb-4 flex justify-end">
                    <Button type="button" variant="secondary" size="sm" onClick={() => { setBranchSourceIndex(messages.length - 1); setBranchName("从最新消息继续"); }}>
                      <CirclePlus className="h-3.5 w-3.5" />从最新消息创建
                    </Button>
                  </div>
                ) : null}
                {branches.length === 0 ? (
                  <div className="grid min-h-[280px] place-items-center border border-dashed border-border bg-background/40 text-center">
                    <div className="max-w-sm px-5"><GitBranch className="mx-auto h-7 w-7 text-[#5B7CFF]" /><p className="mt-3 text-sm font-semibold">还没有本地分支</p><p className="mt-1 text-xs leading-5 text-muted-foreground">在任意消息的工具栏点击分支图标，即可保存截止该消息的上下文。</p></div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {orderedBranches.map((branch) => {
                      const depth = branchDepth(branch, branchById);
                      return (
                        <div key={branch.id} className={cn("group flex min-w-0 items-center gap-2 border border-border bg-background/60 p-3 transition hover:border-[#5B7CFF]/45", activeBranchId === branch.id && "border-[#2DD4BF]/60 bg-[#2DD4BF]/5")} style={{ marginLeft: `${Math.min(depth, 3) * 16}px` }}>
                          {depth ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#2DD4BF]" /> : <Layers3 className="h-3.5 w-3.5 shrink-0 text-[#5B7CFF]" />}
                          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => loadBranch(branch)}>
                            <span className="block truncate text-xs font-semibold">{branch.name}</span>
                            <span className="mt-1 block truncate text-[10px] text-muted-foreground">{branch.messages.length} 条消息 · {new Date(branch.createdAt).toLocaleString()}</span>
                          </button>
                          {activeBranchId === branch.id ? <span className="hidden text-[9px] font-semibold uppercase text-[#2DD4BF] sm:inline">Active</span> : null}
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-red-500" onClick={() => removeBranch(branch)} aria-label={`删除分支 ${branch.name}`} title="删除分支及子分支"><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="soft-scrollbar shrink-0 overflow-y-auto border-b border-border p-4 sm:max-h-[45%] sm:p-5">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(420px,1fr)]">
                    <label className="min-w-0 text-xs font-medium">对比任务
                      <textarea value={prompt} maxLength={4000} onChange={(event) => setPrompt(event.target.value)} placeholder="输入同一项任务，让候选并行作答..." className="mt-1.5 h-32 w-full resize-none rounded-md border border-border bg-background/70 p-3 text-sm leading-6 outline-none focus:border-[#5B7CFF] focus:ring-2 focus:ring-[#5B7CFF]/15" />
                      <span className="mt-1 block text-right text-[10px] tabular-nums text-muted-foreground">{prompt.length}/4000</span>
                    </label>
                    <div className="min-w-0 space-y-2">
                      {contestants.map((contestant, index) => (
                        <div key={`${dialog}-${index}`} className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-2 border border-border bg-background/60 p-2.5 sm:grid-cols-[76px_minmax(90px,.65fr)_minmax(130px,1fr)_auto] sm:items-center">
                          <span className="truncate text-[10px] font-semibold text-[#5B7CFF]">{contestant.label || candidateName(index)}</span>
                          <select value={contestant.provider} onChange={(event) => { const nextProvider = event.target.value as Provider; updateContestant(index, { provider: nextProvider, model: defaultModel(nextProvider) }); }} className="h-9 min-w-0 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-[#5B7CFF]">
                            <option value="openai">OpenAI</option><option value="grok">Grok</option>
                          </select>
                          <select value={contestant.model ?? ""} onChange={(event) => updateContestant(index, { model: event.target.value })} className="col-span-2 h-9 min-w-0 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-[#5B7CFF] sm:col-span-1">
                            {modelByProvider[contestant.provider].length ? modelByProvider[contestant.provider].map((item) => <option key={item.id} value={item.model_id}>{item.display_name}</option>) : <option value="">无可用模型</option>}
                          </select>
                          {dialog === "arena" ? (
                            <Button type="button" variant="ghost" size="icon" className="hidden h-8 w-8 sm:inline-flex" disabled={contestants.length <= 2} onClick={() => setContestants((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`移除${candidateName(index)}`} title="移除候选"><X className="h-3.5 w-3.5" /></Button>
                          ) : <span className="hidden text-right text-[9px] text-muted-foreground sm:block">角色锁定</span>}
                          {dialog === "arena" ? <input value={contestant.role ?? ""} maxLength={500} onChange={(event) => updateContestant(index, { role: event.target.value })} placeholder="可选：候选视角或角色" className="col-span-2 h-8 min-w-0 rounded-md border border-border bg-background/70 px-2 text-[10px] outline-none focus:border-[#2DD4BF] sm:col-span-4" /> : <p className="col-span-2 text-[10px] leading-4 text-muted-foreground sm:col-span-4">{contestant.role}</p>}
                        </div>
                      ))}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {dialog === "arena" && contestants.length < 3 ? <Button type="button" variant="ghost" size="sm" onClick={() => setContestants((current) => [...current, { provider, model: defaultModel(provider), role: "", label: candidateName(current.length) }])}><CirclePlus className="h-3.5 w-3.5" />增加候选</Button> : <span />}
                        <label className="inline-flex cursor-pointer items-center gap-2 text-[10px] font-medium"><input type="checkbox" checked={blind} onChange={(event) => setBlind(event.target.checked)} className="h-4 w-4 accent-[#5B7CFF]" />盲评模式</label>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end"><Button type="button" size="sm" disabled={running || !prompt.trim()} onClick={runArena}>{running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Swords className="h-3.5 w-3.5" />}{running ? "并行执行中" : dialog === "duel" ? "开始对决" : "开始对比"}</Button></div>
                </div>

                <div className="soft-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5">
                  {running ? (
                    <div className="grid min-h-[240px] place-items-center text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-md border border-[#2DD4BF]/30 bg-[#2DD4BF]/8"><Loader2 className="h-5 w-5 animate-spin text-[#2DD4BF]" /></div><p className="mt-3 text-sm font-semibold">{contestants.length} 路模型正在并行推演</p><p className="mt-1 text-xs text-muted-foreground">每一路独立返回，失败结果不会被补写。</p></div></div>
                  ) : results.length ? (
                    <div className={cn("grid min-w-0 gap-3", results.length === 2 ? "lg:grid-cols-2" : "xl:grid-cols-3")}>
                      {results.map((result, index) => {
                        const selected = winner === result.contestant_index;
                        const failed = Boolean(result.error || !result.text.trim());
                        return (
                          <section key={result.contestant_index} className={cn("flex min-w-0 flex-col border bg-background/60", selected ? "border-amber-500/70" : failed ? "border-red-500/35" : "border-border")}>
                            <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                              <div className="min-w-0"><p className="truncate text-xs font-semibold">{blind ? candidateName(index) : `${contestants[index]?.label || candidateName(index)} · ${result.provider === "grok" ? "Grok" : "OpenAI"}/${result.model}`}</p>{!blind && !failed ? <p className="mt-1 flex gap-3 text-[9px] text-muted-foreground"><span className="inline-flex items-center gap-1"><Timer className="h-3 w-3" />{result.latency_ms}ms</span><span className="inline-flex items-center gap-1"><Coins className="h-3 w-3" />{result.tokens.total_tokens}</span></p> : null}</div>
                              {selected ? <Trophy className="h-4 w-4 shrink-0 text-amber-500" /> : null}
                            </div>
                            <div className="soft-scrollbar min-h-[150px] flex-1 overflow-y-auto p-3 text-xs leading-5 sm:max-h-[330px]">
                              {failed ? <p className="text-red-500">{result.error || "模型未返回内容。"}</p> : <div className="whitespace-pre-wrap break-words">{cleanArenaAnswer(result.text)}</div>}
                            </div>
                            <div className="border-t border-border p-2"><Button type="button" variant={selected ? "secondary" : "ghost"} size="sm" className="w-full" disabled={failed} onClick={() => setWinner(result.contestant_index)}>{selected ? <Check className="h-3.5 w-3.5 text-amber-500" /> : <Trophy className="h-3.5 w-3.5" />}{selected ? "已选为胜者" : "选择胜者"}</Button></div>
                          </section>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid min-h-[230px] place-items-center border border-dashed border-border bg-background/35 text-center"><div className="max-w-md px-5"><Swords className="mx-auto h-7 w-7 text-[#5B7CFF]" /><p className="mt-3 text-sm font-semibold">等待同题竞技</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{blind ? "身份和运行指标会在评选时隐藏，降低品牌与速度偏见。" : "模型、耗时和 Token 会随结果显示。"}</p></div></div>
                  )}
                </div>

                {results.length ? (
                  <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
                    <Button type="button" variant="secondary" size="sm" disabled={winner === null} onClick={insertWinner}><FileOutput className="h-3.5 w-3.5" />胜者送入输入区</Button>
                    <Button type="button" size="sm" disabled={results.filter((item) => !item.error && item.text.trim()).length < 2} onClick={mergeResults}><Merge className="h-3.5 w-3.5" />合并为输入</Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>,
        document.body
      ) : null}
    </>
  );
}
