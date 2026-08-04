import type { ArenaResult } from "@/lib/api";

export type ChatPowerMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatBranch = {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: string;
  sourceSessionId: number | null;
  sourceMessageIndex: number;
  messages: ChatPowerMessage[];
};

export type AnswerTransformKind =
  | "tasks"
  | "visual"
  | "workflow"
  | "infographic"
  | "slides"
  | "social";

const BRANCH_STORAGE_KEY = "aiweb_chat_branches_v1";
export const CHAT_POWER_PROMPT_LIMIT = 4000;

const TRANSFORM_INSTRUCTIONS: Record<Exclude<AnswerTransformKind, "visual">, string> = {
  tasks: `把参考回答转化为可直接执行的任务清单。要求：
1. 按阶段分组，标注优先级、负责人角色、前置依赖、交付物和验收标准；
2. 区分 24 小时内、7 天内和后续任务；
3. 补充风险、待确认问题和下一步动作；
4. 不要复述原文，不要虚构已完成事项。`,
  workflow: `把参考回答设计成一条可复用的 AI 工作流草案。要求：
1. 给出名称、适用场景、输入变量及默认值；
2. 至少设计 5 个节点，逐项写明节点目标、输入、处理指令、输出与失败回退；
3. 加入必要的条件分支、人工确认点和质量检查；
4. 最后给出可直接使用的总 Prompt 与一组测试样例。`,
  infographic: `把参考回答重构为信息图内容架构。要求：
1. 给出一句主标题、一句核心结论和清晰的信息层级；
2. 规划 4-7 个视觉模块，每个模块注明数据、文案、图形编码和阅读顺序；
3. 提供配色、字体层级、图标与版式建议；
4. 明确哪些内容来自原回答，哪些需要后续补充数据。`,
  slides: `把参考回答转化为一份 8-12 页的演示稿大纲。每页给出页标题、核心观点、支撑材料、建议视觉和讲述备注，并确保全篇形成问题、洞察、方案、证据、行动的叙事闭环。`,
  social: `把参考回答转化为一组可发布的内容包：一篇专业长帖、三条短帖、五个标题、一个评论区互动问题。保持事实边界，针对不同载体调整节奏，不要使用空泛口号。`
};

function branchStorageKey(userId: number): string {
  return `${BRANCH_STORAGE_KEY}:user:${userId}`;
}

function validMessage(value: unknown): value is ChatPowerMessage {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ChatPowerMessage>;
  return (item.role === "user" || item.role === "assistant") && typeof item.content === "string";
}

function validBranch(value: unknown): value is ChatBranch {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ChatBranch>;
  return (
    typeof item.id === "string" &&
    (item.parentId === null || typeof item.parentId === "string") &&
    typeof item.name === "string" &&
    typeof item.createdAt === "string" &&
    (item.sourceSessionId === null || Number.isSafeInteger(item.sourceSessionId)) &&
    Number.isSafeInteger(item.sourceMessageIndex) &&
    Array.isArray(item.messages) &&
    item.messages.every(validMessage)
  );
}

export function readChatBranches(userId: number | null | undefined): ChatBranch[] {
  if (!userId || typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(branchStorageKey(userId)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(validBranch).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

function writeChatBranches(userId: number, branches: ChatBranch[]): void {
  try {
    localStorage.setItem(branchStorageKey(userId), JSON.stringify(branches.slice(0, 100)));
  } catch {
    throw new Error("浏览器无法保存分支，请检查站点存储空间。");
  }
}

export function createChatBranch(options: {
  userId: number;
  name: string;
  messages: ChatPowerMessage[];
  throughIndex: number;
  sourceSessionId?: number | null;
  parentId?: string | null;
}): ChatBranch {
  const throughIndex = Math.min(Math.max(0, options.throughIndex), options.messages.length - 1);
  const snapshot = options.messages.slice(0, throughIndex + 1).filter(validMessage).map((message) => ({ ...message }));
  if (snapshot.length === 0) throw new Error("当前没有可创建分支的消息。");

  const branch: ChatBranch = {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `branch-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    parentId: options.parentId ?? null,
    name: options.name.trim().slice(0, 80) || `分支 ${new Date().toLocaleString()}`,
    createdAt: new Date().toISOString(),
    sourceSessionId: options.sourceSessionId ?? null,
    sourceMessageIndex: throughIndex,
    messages: snapshot
  };

  writeChatBranches(options.userId, [branch, ...readChatBranches(options.userId)]);
  return branch;
}

export function deleteChatBranch(userId: number, branchId: string): ChatBranch[] {
  const branches = readChatBranches(userId);
  const removed = new Set([branchId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const branch of branches) {
      if (branch.parentId && removed.has(branch.parentId) && !removed.has(branch.id)) {
        removed.add(branch.id);
        changed = true;
      }
    }
  }
  const next = branches.filter((branch) => !removed.has(branch.id));
  writeChatBranches(userId, next);
  return next;
}

function trimSourceWithNotice(source: string, available: number): string {
  const normalized = source.trim();
  if (normalized.length <= available) return normalized;
  const notice = "\n\n[来源内容较长，此处仅装入开头与结尾；请回到原回答核对完整内容。]\n\n";
  const remaining = Math.max(0, available - notice.length);
  const headLength = Math.ceil(remaining * 0.58);
  return `${normalized.slice(0, headLength)}${notice}${normalized.slice(-(remaining - headLength))}`;
}

function composeWithinLimit(prefix: string, source: string, suffix = ""): string {
  const available = CHAT_POWER_PROMPT_LIMIT - prefix.length - suffix.length;
  if (available <= 0) throw new Error("结构化指令超过输入限制。");
  return `${prefix}${trimSourceWithNotice(source, available)}${suffix}`;
}

export function buildBranchContextPrompt(branch: ChatBranch): string {
  const transcript = branch.messages
    .map((message, index) => `### ${index + 1}. ${message.role === "user" ? "用户" : "助手"}\n${message.content.trim()}`)
    .join("\n\n");
  return composeWithinLimit(
    `继续本地对话分支「${branch.name}」。以下内容是只读上下文快照，不要声称它已写入当前服务端会话；请基于它继续回答。\n\n`,
    transcript,
    "\n\n### 继续任务\n请先确认你理解的分支目标，再给出最有价值的下一步。"
  );
}

export function buildAnswerTransformPrompt(kind: Exclude<AnswerTransformKind, "visual">, answer: string): string {
  return composeWithinLimit(`${TRANSFORM_INSTRUCTIONS[kind]}\n\n## 参考回答\n`, answer);
}

export function buildVisualBrief(answer: string): string {
  return composeWithinLimit(
    `根据以下内容创作一张信息密度高、主体清晰的专业视觉。先提炼核心概念，再用一个明确主视觉、层次化信息模块和连贯的视觉动线表达；避免堆字、装饰性渐变和无意义科技元素。画面中的文字只保留必要短语，确保可读。\n\n参考内容：\n`,
    answer
  );
}

export function buildArenaMergePrompt(results: ArenaResult[]): string {
  const successful = results.filter((result) => result.text.trim() && !result.error);
  if (successful.length < 2) throw new Error("至少需要两份成功结果才能合并。");
  const source = successful
    .map((result, index) => `### 候选 ${index + 1} · ${result.provider}/${result.model}\n${result.text.trim()}`)
    .join("\n\n");
  return composeWithinLimit(
    `综合以下候选回答，产出一份更准确、更完整且没有重复内容的最终版本。先识别共识与冲突；冲突无法从材料中验证时要明确保留不确定性，不得虚构裁决依据。最终只输出融合后的答案。\n\n`,
    source
  );
}

export function seedPromptFromText(text: string): string {
  return trimSourceWithNotice(text, CHAT_POWER_PROMPT_LIMIT);
}
