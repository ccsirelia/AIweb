"use client";

import {
  Check,
  Copy,
  ImageIcon,
  Lightbulb,
  MessageSquareText,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Send,
  Sparkles,
  Star,
  Tags,
  Trash2,
  WandSparkles,
  X
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { AUTH_CHANGED_EVENT, getStoredUser } from "@/lib/api";
import { cn } from "@/lib/utils";

export type InspirationTarget = "chat" | "image";

export interface PendingPromptDetail {
  prompt: string;
  target: InspirationTarget;
}

interface InspirationItem {
  id: string;
  title: string;
  prompt: string;
  target: InspirationTarget;
  tags: string[];
  origin: "built-in" | "custom";
  createdAt?: string;
  updatedAt?: string;
}

interface InspirationForm {
  title: string;
  prompt: string;
  target: InspirationTarget;
  tags: string;
}

interface StoredCapsuleState {
  version: 1;
  items: InspirationItem[];
  favoriteIds: string[];
}

type LibraryFilter = "all" | "favorites" | InspirationTarget;
type MobileView = "library" | "editor";

export const INSPIRATION_STORAGE_KEY = "aiweb:inspiration-capsule:v1";
export const INSPIRATION_CHANGED_EVENT = "aiweb:inspiration-capsule-changed";
export const PENDING_PROMPT_STORAGE_KEY = "aiweb:pending-prompt";
export const PROMPT_INSERT_EVENT = "aiweb:prompt-insert";
const CHAT_PROMPT_LIMIT = 4000;
const IMAGE_PROMPT_LIMIT = 1200;
const TAG_LENGTH_LIMIT = 24;

const emptyForm: InspirationForm = {
  title: "",
  prompt: "",
  target: "chat",
  tags: ""
};

const builtInInspirations: InspirationItem[] = [
  {
    id: "signal-cognitive-radar",
    title: "认知盲区雷达",
    target: "chat",
    tags: ["决策", "复盘", "苏格拉底"],
    origin: "built-in",
    prompt: `你是我的认知盲区雷达。先让我用不超过 200 字描述一个正在犹豫的问题；如果信息不足，只追问 3 个最关键的问题。随后请：
1. 区分事实、假设、情绪和外部压力；
2. 找出我可能正在回避的代价，以及至少 3 个隐藏前提；
3. 从支持者、反对者和一年后的我三个视角分别挑战当前判断；
4. 给出一个低成本、可逆、48 小时内能执行的验证实验；
5. 最后只用一句话指出最值得正视的盲区。
不要替我做决定，也不要用空泛的鼓励代替分析。`
  },
  {
    id: "signal-idea-trident",
    title: "三轨创意发散器",
    target: "chat",
    tags: ["创意", "脑暴", "产品"],
    origin: "built-in",
    prompt: `请先询问我要解决的主题、目标人群和限制条件，然后沿三条轨道并行发散：
- 务实轨：今天就能验证、资源要求最低的 6 个想法；
- 跃迁轨：需要跨界组合或改变规则的 6 个想法；
- 异想轨：看似荒诞但能启发新机制的 6 个想法。

不要只换措辞，每个想法必须拥有不同的核心机制。最后用“新颖度 / 实用性 / 验证成本 / 传播性”四项各 5 分评分，选出最值得组合的 3 个想法，并把它们融合为一个可执行概念。`
  },
  {
    id: "signal-seven-day-lab",
    title: "七日微型实验室",
    target: "chat",
    tags: ["行动", "习惯", "实验"],
    origin: "built-in",
    prompt: `把我接下来提供的模糊目标，转化成一场七天微型实验。请先确认目标、每天可用时间、不能突破的边界和可观测信号，然后输出：
1. 一条可证伪的实验假设；
2. 每天 15-45 分钟的最小行动，难度逐步递进；
3. 一个不依赖主观感受的核心指标和两个辅助指标；
4. 每天结束时只需 2 分钟完成的记录模板；
5. 第七天的继续、调整、停止判定阈值；
6. 最可能中断实验的三个障碍及预案。
方案要轻量、可恢复，漏掉一天时不要推倒重来。`
  },
  {
    id: "signal-expert-room",
    title: "异质专家会议室",
    target: "chat",
    tags: ["策略", "多视角", "推演"],
    origin: "built-in",
    prompt: `围绕我给出的议题，组建一个真正观点异质的四人临时会议室：领域专家、系统思考者、苛刻的一线执行者、代表最终用户的人。先说明每个人的判断标准，再进行两轮讨论：第一轮独立陈述，第二轮必须回应他人的具体观点并修正或坚持立场。

主持人最后整理：已经形成的共识、无法消除的分歧、被忽视的变量、最小验证行动，以及“什么新证据会改变结论”。不要让四个角色说出同一种答案，也不要虚构无法确认的事实。`
  },
  {
    id: "signal-future-specimen",
    title: "未来博物馆标本",
    target: "image",
    tags: ["概念艺术", "未来", "静物"],
    origin: "built-in",
    prompt: `一件来自近未来日常生活的神秘物件，被陈列在 2089 年的设计博物馆中。它看起来真实可用，功能通过结构、磨损和材质自然显现，而不是依赖文字解释。精密的玻璃展台，冷白环境光与一束克制的青绿色轮廓光，深色吸光背景，博物馆级静物摄影，清晰的前中后景层次，材质微瑕疵可信，构图留有呼吸感。画面中不要出现文字、标签、Logo、水印、人物或装饰性全息界面，避免通用科幻道具感。`
  },
  {
    id: "signal-mechanical-universe",
    title: "微缩机械宇宙",
    target: "image",
    tags: ["微缩", "机械", "产品视觉"],
    origin: "built-in",
    prompt: `一个精密机械装置的内部被重构成可居住的微缩世界：齿轮成为广场，导轨成为交通线，微型维护人员正在执行明确的工作。宏观产品摄影与建筑模型摄影融合，真实金属、陶瓷和透明聚合物材质，结构遵循机械逻辑，尺度参照清晰；侧上方硬光塑造轮廓，柔和补光保留暗部细节，局部暖色工作灯与冷色环境形成克制对比。超高细节但视觉层级明确，无文字、无水印、无凌乱线缆、无悬浮界面。`
  }
];

const filters: Array<{ value: LibraryFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "favorites", label: "收藏" },
  { value: "chat", label: "对话" },
  { value: "image", label: "视觉" }
];

const quickTags = ["研究", "写作", "产品", "灵感", "视觉", "实验"];

function isTarget(value: unknown): value is InspirationTarget {
  return value === "chat" || value === "image";
}

function getPromptLimit(target: InspirationTarget): number {
  return target === "chat" ? CHAT_PROMPT_LIMIT : IMAGE_PROMPT_LIMIT;
}

function getScopedInspirationStorageKey(): string {
  const userId = getStoredUser()?.id;
  return Number.isInteger(userId) ? `${INSPIRATION_STORAGE_KEY}:user:${userId}` : `${INSPIRATION_STORAGE_KEY}:guest`;
}

function readMigratedInspirationValue(key: string): string | null {
  try {
    const scopedValue = window.localStorage.getItem(key);
    if (key.endsWith(":guest")) return scopedValue;
    const legacyValue = window.localStorage.getItem(INSPIRATION_STORAGE_KEY);
    if (scopedValue !== null) {
      if (legacyValue !== null) window.localStorage.removeItem(INSPIRATION_STORAGE_KEY);
      return scopedValue;
    }
    if (legacyValue !== null) {
      window.localStorage.setItem(key, legacyValue);
      window.localStorage.removeItem(INSPIRATION_STORAGE_KEY);
      return legacyValue;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeStoredItem(value: unknown): InspirationItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<InspirationItem>;
  if (
    typeof item.id !== "string" ||
    typeof item.title !== "string" ||
    typeof item.prompt !== "string" ||
    !isTarget(item.target) ||
    !Array.isArray(item.tags)
  ) {
    return null;
  }

  const title = item.title.trim().slice(0, 72);
  const prompt = item.prompt.trim();
  if (!title || !prompt) return null;

  return {
    id: item.id,
    title,
    prompt,
    target: item.target,
    tags: Array.from(
      new Set(
        item.tags
          .filter((tag): tag is string => typeof tag === "string")
          .map((tag) => tag.trim().slice(0, TAG_LENGTH_LIMIT))
          .filter(Boolean)
      )
    ).slice(0, 8),
    origin: "custom",
    createdAt: typeof item.createdAt === "string" ? item.createdAt : undefined,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : undefined
  };
}

function readStoredState(): Pick<StoredCapsuleState, "items" | "favoriteIds"> {
  if (typeof window === "undefined") return { items: [], favoriteIds: [] };
  const storageKey = getScopedInspirationStorageKey();
  try {
    const parsed = JSON.parse(readMigratedInspirationValue(storageKey) ?? "null") as Partial<StoredCapsuleState> | null;
    if (!parsed || !Array.isArray(parsed.items)) return { items: [], favoriteIds: [] };
    const items = parsed.items.map(normalizeStoredItem).filter((item): item is InspirationItem => Boolean(item));
    const favoriteIds = Array.isArray(parsed.favoriteIds)
      ? Array.from(new Set(parsed.favoriteIds.filter((id): id is string => typeof id === "string")))
      : [];
    return { items, favoriteIds };
  } catch {
    return { items: [], favoriteIds: [] };
  }
}

function writeStoredState(items: InspirationItem[], favoriteIds: string[]): boolean {
  try {
    const storageKey = getScopedInspirationStorageKey();
    const state: StoredCapsuleState = { version: 1, items, favoriteIds };
    window.localStorage.setItem(storageKey, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent(INSPIRATION_CHANGED_EVENT));
    return true;
  } catch {
    return false;
  }
}

function createItemId(): string {
  if (typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function") {
    return `idea-${window.crypto.randomUUID()}`;
  }
  return `idea-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,，#\n]+/)
        .map((tag) => tag.trim().slice(0, TAG_LENGTH_LIMIT))
        .filter(Boolean)
    )
  ).slice(0, 8);
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      return copied;
    } catch {
      return false;
    }
  }
}

export function InspirationCapsule() {
  const router = useRouter();
  const pathname = usePathname();
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [customItems, setCustomItems] = useState<InspirationItem[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [mobileView, setMobileView] = useState<MobileView>("library");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<InspirationForm>(emptyForm);
  const promptLimit = getPromptLimit(form.target);

  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const allItems = useMemo(() => [...builtInInspirations, ...customItems], [customItems]);
  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return allItems
      .filter((item) => {
        if (filter === "favorites" && !favoriteSet.has(item.id)) return false;
        if ((filter === "chat" || filter === "image") && item.target !== filter) return false;
        if (!normalized) return true;
        return `${item.title} ${item.prompt} ${item.tags.join(" ")}`.toLowerCase().includes(normalized);
      })
      .sort((a, b) => Number(favoriteSet.has(b.id)) - Number(favoriteSet.has(a.id)));
  }, [allItems, favoriteSet, filter, query]);

  useEffect(() => {
    setMounted(true);
    const refresh = () => {
      const stored = readStoredState();
      setCustomItems(stored.items);
      setFavoriteIds(stored.favoriteIds);
    };
    const refreshAccount = () => {
      setOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      refresh();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === "aiweb_user") {
        refreshAccount();
        return;
      }
      const scopedKey = getScopedInspirationStorageKey();
      if (!event.key || event.key === scopedKey || event.key === INSPIRATION_STORAGE_KEY) refresh();
    };
    refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener(INSPIRATION_CHANGED_EVENT, refresh);
    window.addEventListener(AUTH_CHANGED_EVENT, refreshAccount);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(INSPIRATION_CHANGED_EVENT, refresh);
      window.removeEventListener(AUTH_CHANGED_EVENT, refreshAccount);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      searchRef.current?.focus();
      if (document.activeElement === previouslyFocused) dialogRef.current?.focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
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

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      (previouslyFocused ?? triggerRef.current)?.focus();
    };
  }, [open]);

  function persist(items: InspirationItem[], favorites: string[]): boolean {
    const stored = writeStoredState(items, favorites);
    if (!stored) toast.error("本地存储空间不可用，未保存本次修改");
    return stored;
  }

  function resetForm(target: InspirationTarget = "chat") {
    setEditingId(null);
    setForm({ ...emptyForm, target });
  }

  function openNewItem() {
    resetForm();
    setMobileView("editor");
  }

  function beginEdit(item: InspirationItem) {
    if (item.origin !== "custom") return;
    setEditingId(item.id);
    setForm({ title: item.title, prompt: item.prompt, target: item.target, tags: item.tags.join("，") });
    setMobileView("editor");
  }

  function beginVariant(item: InspirationItem) {
    setEditingId(null);
    setForm({
      title: `${item.title} · 变体`,
      prompt: item.prompt,
      target: item.target,
      tags: item.tags.join("，")
    });
    setMobileView("editor");
    toast.success("已载入编辑台，可继续改写");
  }

  function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = form.title.trim();
    const prompt = form.prompt.trim();
    if (!title) {
      toast.error("请填写灵感标题");
      return;
    }
    if (!prompt) {
      toast.error("请填写 Prompt 正文");
      return;
    }
    if (prompt.length > getPromptLimit(form.target)) {
      toast.error(`${form.target === "chat" ? "对话" : "视觉"} Prompt 不能超过 ${getPromptLimit(form.target)} 个字符`);
      return;
    }
    if (form.tags.split(/[,，#\n]+/).some((tag) => tag.trim().length > TAG_LENGTH_LIMIT)) {
      toast.error(`单个标签不能超过 ${TAG_LENGTH_LIMIT} 个字符`);
      return;
    }

    const now = new Date().toISOString();
    const existing = editingId ? customItems.find((item) => item.id === editingId) : undefined;
    const item: InspirationItem = {
      id: existing?.id ?? createItemId(),
      title: title.slice(0, 72),
      prompt,
      target: form.target,
      tags: parseTags(form.tags),
      origin: "custom",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    const next = [item, ...customItems.filter((candidate) => candidate.id !== item.id)];
    if (!persist(next, favoriteIds)) return;
    setCustomItems(next);
    setEditingId(item.id);
    setForm({ title: item.title, prompt: item.prompt, target: item.target, tags: item.tags.join("，") });
    toast.success(existing ? "灵感已更新" : "灵感已封存");
  }

  function deleteItem(item: InspirationItem) {
    if (item.origin !== "custom") return;
    if (!window.confirm(`确定删除「${item.title}」吗？删除后无法恢复。`)) return;
    const nextItems = customItems.filter((candidate) => candidate.id !== item.id);
    const nextFavorites = favoriteIds.filter((id) => id !== item.id);
    if (!persist(nextItems, nextFavorites)) return;
    setCustomItems(nextItems);
    setFavoriteIds(nextFavorites);
    if (editingId === item.id) resetForm(item.target);
    toast.success("自建灵感已删除");
  }

  function toggleFavorite(item: InspirationItem) {
    const next = favoriteSet.has(item.id)
      ? favoriteIds.filter((id) => id !== item.id)
      : [item.id, ...favoriteIds];
    if (!persist(customItems, next)) return;
    setFavoriteIds(next);
  }

  async function copyPrompt(prompt: string) {
    const copied = await copyText(prompt);
    if (copied) toast.success("Prompt 已复制");
    else toast.error("无法访问剪贴板");
  }

  function usePrompt(prompt: string, target: InspirationTarget) {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      toast.error("先写下一段 Prompt");
      return;
    }
    const limit = getPromptLimit(target);
    if (normalizedPrompt.length > limit) {
      toast.error(`${target === "chat" ? "对话" : "视觉"} Prompt 不能超过 ${limit} 个字符，请精简后重试`);
      return;
    }

    const detail: PendingPromptDetail = { prompt: normalizedPrompt, target };
    try {
      window.sessionStorage.setItem(PENDING_PROMPT_STORAGE_KEY, JSON.stringify(detail));
    } catch {
      toast.error("无法暂存 Prompt");
      return;
    }

    const destination = target === "chat" ? "/chat" : "/image";
    setOpen(false);
    if (pathname === destination) {
      window.dispatchEvent(new CustomEvent<PendingPromptDetail>(PROMPT_INSERT_EVENT, { detail }));
    } else {
      router.push(destination);
    }
    toast.success(target === "chat" ? "已发送到 AI 对话" : "已发送到视觉工坊");
  }

  function addQuickTag(tag: string) {
    const current = parseTags(form.tags);
    if (current.includes(tag)) return;
    setForm((value) => ({ ...value, tags: [...current, tag].join("，") }));
  }

  const modal = open ? (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-[#05070D]/[0.78] p-0 backdrop-blur-md sm:items-center sm:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
    >
      <div
        ref={dialogRef}
        id="inspiration-capsule-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
        tabIndex={-1}
        className="relative flex h-[96dvh] w-full max-w-[1160px] flex-col overflow-hidden rounded-t-lg border border-white/10 bg-[#0A0D14] text-[#F8FAFC] shadow-[0_32px_120px_rgba(0,0,0,0.72)] outline-none sm:h-[min(840px,90vh)] sm:rounded-lg"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(rgba(91,124,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(45,212,191,.04) 1px, transparent 1px)",
            backgroundSize: "30px 30px",
            maskImage: "linear-gradient(to bottom, black, transparent 72%)"
          }}
        />
        <div aria-hidden="true" className="absolute inset-x-0 top-0 z-10 flex h-px">
          <span className="w-[36%] bg-[#5B7CFF]" />
          <span className="w-[18%] bg-[#2DD4BF]" />
          <span className="flex-1 bg-white/10" />
        </div>

        <header className="relative z-10 flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[#0A0D14]/[0.92] px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-md border border-[#FBBF24]/25 bg-[#FBBF24]/10 text-[#FBBF24]">
              <Lightbulb className="h-[18px] w-[18px]" />
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-[1px] border-2 border-[#0A0D14] bg-[#2DD4BF]" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 id={dialogTitleId} className="truncate text-sm font-semibold sm:text-base">灵感胶囊</h2>
                <span className="hidden rounded-sm border border-[#2DD4BF]/25 bg-[#2DD4BF]/[0.08] px-1.5 py-0.5 text-[8px] font-bold text-[#5EEAD4] sm:inline">LOCAL SIGNAL VAULT</span>
              </div>
              <p id={dialogDescriptionId} className="mt-0.5 truncate text-[10px] text-white/[0.42] sm:text-[11px]">
                {allItems.length} 条信号 · {favoriteIds.length} 条收藏 · 本地同步
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={openNewItem}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-[#5B7CFF]/30 bg-[#5B7CFF]/10 px-2.5 text-[11px] font-semibold text-[#A8B6FF] transition hover:border-[#5B7CFF]/55 hover:bg-[#5B7CFF]/[0.18] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B7CFF]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">记录灵感</span>
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="关闭灵感胶囊"
              title="关闭"
              className="grid h-9 w-9 place-items-center rounded-md text-white/50 transition hover:bg-white/[0.07] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B7CFF]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="relative z-10 grid grid-cols-2 border-b border-white/10 bg-[#0D111A] p-1.5 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileView("library")}
            className={cn(
              "h-8 rounded-md text-[11px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5B7CFF]",
              mobileView === "library" ? "bg-white/[0.08] text-white" : "text-white/45"
            )}
          >
            灵感库 · {visibleItems.length}
          </button>
          <button
            type="button"
            onClick={() => setMobileView("editor")}
            className={cn(
              "h-8 rounded-md text-[11px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5B7CFF]",
              mobileView === "editor" ? "bg-white/[0.08] text-white" : "text-white/45"
            )}
          >
            {editingId ? "编辑信号" : "记录信号"}
          </button>
        </div>

        <div className="relative z-10 grid min-h-0 flex-1 lg:grid-cols-[minmax(320px,0.82fr)_minmax(0,1.18fr)]">
          <section className={cn("min-h-0 flex-col border-white/10 bg-[#0D111A]/[0.88] lg:flex lg:border-r", mobileView === "library" ? "flex" : "hidden")} aria-label="灵感库">
            <div className="shrink-0 space-y-3 border-b border-white/10 p-3 sm:p-4">
              <label className="flex h-10 items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 transition focus-within:border-[#5B7CFF]/60 focus-within:ring-2 focus-within:ring-[#5B7CFF]/10">
                <Search className="h-3.5 w-3.5 shrink-0 text-white/35" />
                <span className="sr-only">搜索灵感</span>
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索标题、正文或标签"
                  className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/[0.28]"
                />
                {query ? (
                  <button type="button" onClick={() => setQuery("")} aria-label="清空搜索" className="grid h-7 w-7 place-items-center rounded text-white/35 hover:bg-white/[0.06] hover:text-white">
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </label>
              <div className="grid grid-cols-4 gap-1 rounded-md border border-white/[0.08] bg-black/15 p-1" role="group" aria-label="筛选灵感">
                {filters.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setFilter(item.value)}
                    aria-pressed={filter === item.value}
                    className={cn(
                      "h-7 min-w-0 rounded text-[10px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5B7CFF]",
                      filter === item.value ? "bg-white/[0.09] text-white shadow-sm" : "text-white/[0.38] hover:text-white/70"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="soft-scrollbar min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
              <div className="space-y-2.5">
                {visibleItems.map((item) => {
                  const isFavorite = favoriteSet.has(item.id);
                  const TargetIcon = item.target === "chat" ? MessageSquareText : ImageIcon;
                  return (
                    <article
                      key={item.id}
                      className={cn(
                        "group relative overflow-hidden rounded-md border bg-white/[0.025] p-3 transition hover:-translate-y-px hover:bg-white/[0.04]",
                        isFavorite ? "border-[#FBBF24]/[0.24]" : "border-white/[0.09] hover:border-white/15"
                      )}
                    >
                      <span aria-hidden="true" className={cn("absolute inset-y-3 left-0 w-0.5", item.target === "chat" ? "bg-[#2DD4BF]/70" : "bg-[#FB7185]/70")} />
                      <div className="flex items-start gap-3 pl-1">
                        <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border", item.target === "chat" ? "border-[#2DD4BF]/20 bg-[#2DD4BF]/[0.08] text-[#5EEAD4]" : "border-[#FB7185]/20 bg-[#FB7185]/[0.08] text-[#FDA4AF]")}>
                          <TargetIcon className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-white">{item.title}</h3>
                            <span className="shrink-0 text-[9px] font-bold uppercase text-white/[0.48]">{item.origin === "built-in" ? "CORE" : "MINE"}</span>
                          </div>
                          <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-[11px] leading-[1.55] text-white/[0.62]">{item.prompt}</p>
                          {item.tags.length ? (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {item.tags.slice(0, 4).map((tag) => (
                                <span key={tag} className="rounded-sm border border-white/[0.12] bg-white/[0.05] px-1.5 py-0.5 text-[9px] text-white/[0.58]">#{tag}</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.065] pt-2.5">
                        <button
                          type="button"
                          onClick={() => usePrompt(item.prompt, item.target)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#5B7CFF] px-2.5 text-[10px] font-semibold text-white shadow-[0_8px_24px_rgba(91,124,255,0.18)] transition hover:bg-[#6D87FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8EA2FF]"
                        >
                          <Send className="h-3 w-3" />
                          立即使用
                        </button>
                        <div className="flex items-center gap-0.5">
                          <button type="button" onClick={() => beginVariant(item)} aria-label={`制作「${item.title}」的变体`} title="制作变体" className="grid h-8 w-8 place-items-center rounded-md text-white/35 transition hover:bg-[#A78BFA]/10 hover:text-[#C4B5FD] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#A78BFA]">
                            <WandSparkles className="h-3.5 w-3.5" />
                          </button>
                          {item.origin === "custom" ? (
                            <>
                              <button type="button" onClick={() => beginEdit(item)} aria-label={`编辑「${item.title}」`} title="编辑" className="grid h-8 w-8 place-items-center rounded-md text-white/35 transition hover:bg-white/[0.07] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5B7CFF]">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button type="button" onClick={() => deleteItem(item)} aria-label={`删除「${item.title}」`} title="删除" className="grid h-8 w-8 place-items-center rounded-md text-white/35 transition hover:bg-[#FB7185]/10 hover:text-[#FDA4AF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FB7185]">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          ) : null}
                          <button type="button" onClick={() => void copyPrompt(item.prompt)} aria-label={`复制「${item.title}」`} title="复制 Prompt" className="grid h-8 w-8 place-items-center rounded-md text-white/35 transition hover:bg-white/[0.07] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5B7CFF]">
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => toggleFavorite(item)} aria-label={isFavorite ? `取消收藏「${item.title}」` : `收藏「${item.title}」`} title={isFavorite ? "取消收藏" : "收藏"} className={cn("grid h-8 w-8 place-items-center rounded-md transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FBBF24]", isFavorite ? "bg-[#FBBF24]/10 text-[#FBBF24]" : "text-white/35 hover:bg-[#FBBF24]/[0.08] hover:text-[#FBBF24]")}>
                            <Star className={cn("h-3.5 w-3.5", isFavorite && "fill-current")} />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              {!visibleItems.length ? (
                <div className="grid min-h-52 place-items-center rounded-md border border-dashed border-white/10 px-6 text-center">
                  <div>
                    <Search className="mx-auto h-5 w-5 text-white/[0.22]" />
                    <p className="mt-3 text-xs font-medium text-white/55">没有捕获到匹配信号</p>
                    <button type="button" onClick={() => { setQuery(""); setFilter("all"); }} className="mt-2 text-[10px] font-semibold text-[#8EA2FF] hover:text-[#A8B6FF]">重置筛选</button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <form onSubmit={saveItem} className={cn("min-h-0 flex-col bg-[#090C12]/[0.94] lg:flex", mobileView === "editor" ? "flex" : "hidden")} aria-label={editingId ? "编辑灵感" : "记录灵感"}>
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
              <div>
                <div className="flex items-center gap-2 text-[9px] font-bold uppercase text-[#8EA2FF]">
                  <Sparkles className="h-3 w-3" />
                  SIGNAL COMPOSER / {editingId ? "EDIT" : "NEW"}
                </div>
                <h3 className="mt-1 text-sm font-semibold">{editingId ? "校准灵感信号" : "封存一个新想法"}</h3>
              </div>
              <button type="button" onClick={() => resetForm(form.target)} aria-label="清空表单" title="清空表单" className="grid h-9 w-9 place-items-center rounded-md border border-white/[0.08] text-white/35 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5B7CFF]">
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="soft-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
              <div className="mx-auto max-w-2xl space-y-4">
                <label className="block">
                  <span className="mb-1.5 flex items-center justify-between gap-3 text-[10px] font-semibold text-white/[0.68]">
                    灵感标题
                    <span className="font-normal tabular-nums text-white/[0.24]">{form.title.length}/72</span>
                  </span>
                  <input
                    value={form.title}
                    onChange={(event) => setForm((value) => ({ ...value, title: event.target.value }))}
                    maxLength={72}
                    placeholder="给这束信号一个易识别的名字"
                    className="h-11 w-full rounded-md border border-white/10 bg-white/[0.035] px-3 text-xs text-white outline-none transition placeholder:text-white/25 focus:border-[#5B7CFF]/65 focus:ring-2 focus:ring-[#5B7CFF]/10"
                  />
                </label>

                <fieldset>
                  <legend className="mb-1.5 text-[10px] font-semibold text-white/[0.68]">目标通道</legend>
                  <div className="grid grid-cols-2 gap-1 rounded-md border border-white/10 bg-black/20 p-1">
                    {(["chat", "image"] as InspirationTarget[]).map((target) => {
                      const Icon = target === "chat" ? MessageSquareText : ImageIcon;
                      const selected = form.target === target;
                      return (
                        <button
                          key={target}
                          type="button"
                          onClick={() => setForm((value) => ({ ...value, target }))}
                          aria-pressed={selected}
                          className={cn(
                            "flex h-9 items-center justify-center gap-2 rounded-md text-[10px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5B7CFF]",
                            selected
                              ? target === "chat" ? "bg-[#2DD4BF]/10 text-[#5EEAD4]" : "bg-[#FB7185]/10 text-[#FDA4AF]"
                              : "text-white/35 hover:text-white/65"
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {target === "chat" ? "AI 对话" : "视觉工坊"}
                          {selected ? <Check className="h-3 w-3" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <label className="block">
                  <span className="mb-1.5 flex items-center justify-between gap-3 text-[10px] font-semibold text-white/[0.68]">
                    Prompt 正文
                    <span className="font-normal tabular-nums text-white/[0.42]">{form.prompt.length.toLocaleString()}/{promptLimit.toLocaleString()}</span>
                  </span>
                  <textarea
                    value={form.prompt}
                    onChange={(event) => setForm((value) => ({ ...value, prompt: event.target.value }))}
                    maxLength={promptLimit}
                    rows={10}
                    placeholder="写下任务背景、目标、限制、期望输出，或任何还没成形的念头…"
                    className="min-h-52 w-full resize-y rounded-md border border-white/10 bg-white/[0.035] px-3 py-3 text-xs leading-5 text-white outline-none transition placeholder:text-white/25 focus:border-[#5B7CFF]/65 focus:ring-2 focus:ring-[#5B7CFF]/10"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold text-white/[0.68]">
                    <Tags className="h-3 w-3 text-[#FBBF24]" />
                    标签
                  </span>
                  <input
                    value={form.tags}
                    onChange={(event) => setForm((value) => ({ ...value, tags: event.target.value }))}
                    maxLength={160}
                    placeholder={`用逗号分隔，最多 8 个，每个不超过 ${TAG_LENGTH_LIMIT} 字符`}
                    className="h-11 w-full rounded-md border border-white/10 bg-white/[0.035] px-3 text-xs text-white outline-none transition placeholder:text-white/25 focus:border-[#5B7CFF]/65 focus:ring-2 focus:ring-[#5B7CFF]/10"
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {quickTags.map((tag) => (
                      <button key={tag} type="button" onClick={() => addQuickTag(tag)} className="rounded-sm border border-white/[0.08] px-2 py-1 text-[9px] text-white/[0.34] transition hover:border-[#FBBF24]/30 hover:bg-[#FBBF24]/[0.07] hover:text-[#FDE68A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FBBF24]">
                        + {tag}
                      </button>
                    ))}
                  </div>
                </label>
              </div>
            </div>

            <footer className="shrink-0 border-t border-white/10 bg-[#0B0E15]/[0.96] px-4 py-3 sm:px-5">
              <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
                <div className="hidden items-center gap-2 text-[9px] font-semibold uppercase text-white/[0.24] sm:flex">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#2DD4BF]" />
                  LOCAL PERSISTENCE READY
                </div>
                <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-initial">
                  <button
                    type="submit"
                    className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-md border border-white/[0.12] bg-white/[0.055] px-3 text-[11px] font-semibold text-white/[0.72] transition hover:bg-white/[0.09] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B7CFF] sm:flex-initial"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {editingId ? "保存修改" : "保存灵感"}
                  </button>
                  <button
                    type="button"
                    onClick={() => usePrompt(form.prompt, form.target)}
                    className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-md bg-[#5B7CFF] px-3.5 text-[11px] font-semibold text-white shadow-[0_10px_28px_rgba(91,124,255,0.22)] transition hover:bg-[#6D87FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8EA2FF] sm:flex-initial"
                  >
                    <Send className="h-3.5 w-3.5" />
                    立即使用
                  </button>
                </div>
              </div>
            </footer>
          </form>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { setOpen(true); setMobileView("library"); }}
        aria-label="打开灵感胶囊"
        aria-expanded={open}
        aria-controls="inspiration-capsule-dialog"
        title="灵感胶囊"
        className="group relative grid h-10 w-10 shrink-0 place-items-center rounded-md border border-border bg-card text-muted-foreground transition hover:border-[#FBBF24]/45 hover:bg-[#FBBF24]/[0.07] hover:text-[#D9A514] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FBBF24] dark:hover:text-[#FBBF24]"
      >
        <Lightbulb className="h-4 w-4 transition group-hover:-rotate-6 group-hover:scale-105" />
        <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-[1px] border border-card bg-[#2DD4BF] shadow-[0_0_8px_rgba(45,212,191,0.75)]" />
      </button>
      {mounted && modal ? createPortal(modal, document.body) : null}
    </>
  );
}
