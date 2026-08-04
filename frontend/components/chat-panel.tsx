"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Brain,
  Check,
  Clock3,
  Copy,
  FileDown,
  FileText,
  Loader2,
  MessageSquareText,
  Paperclip,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Search,
  SendHorizontal,
  Square,
  Trash2,
  X
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { toast } from "sonner";

import {
  createChatJob,
  ApiError,
  deleteChatSession,
  downloadChatAnswerWord,
  getAuthToken,
  getChatJob,
  getChatModels,
  getChatSession,
  getChatSessions,
  getStoredUser,
  streamChat,
  updateChatSession,
  type ChatJob,
  type ChatModel,
  type ChatSession,
  type Provider
} from "@/lib/api";
import { PageShell } from "@/components/page-shell";
import { AnswerActionBar, ChatPowerTools, MessageBranchButton } from "@/components/chat-power-tools";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { WorkflowPicker } from "@/components/workflow-picker";
import { cn } from "@/lib/utils";

type Message = {
  role: "user" | "assistant";
  content: string;
  streamId?: string;
};

type ParsedAssistantContent = {
  thought: string;
  answer: string;
};

const ACTIVE_SESSION_KEY = "aiweb_active_chat_session_id";
const PENDING_JOBS_KEY = "aiweb_pending_chat_jobs";
const CHAT_PROVIDER_KEY = "aiweb_chat_provider";
const CHAT_MODEL_KEY_PREFIX = "aiweb_chat_model_";
const CHAT_DRAFT_KEY = "aiweb_chat_draft_v1";
const PENDING_PROMPT_KEY = "aiweb:pending-prompt";
const PROMPT_INSERT_EVENT = "aiweb:prompt-insert";
const CHAT_FOCUS_KEY = "aiweb_chat_focus_mode";
const CHAT_PROMPT_LIMIT = 4000;
const FILE_ACCEPT = "image/*,.txt,.md,.csv,.json,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.py,.js,.jsx,.ts,.tsx,.html,.css,.xml,.yaml,.yml";

const providers: { label: string; value: Provider }[] = [
  { label: "OpenAI", value: "openai" },
  { label: "Grok", value: "grok" }
];

function readPendingJobs(): ChatJob[] {
  if (typeof window === "undefined") return [];
  const raw = readMigratedUserStorageValue(PENDING_JOBS_KEY).value;
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ChatJob[];
  } catch {
    return [];
  }
}

function writePendingJobs(jobs: ChatJob[]) {
  const key = getUserStorageKey(PENDING_JOBS_KEY);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(jobs));
  } catch {
    // The server remains authoritative when browser storage is unavailable.
  }
}

function getUserStorageKey(baseKey: string): string | null {
  const userId = getStoredUser()?.id;
  return Number.isInteger(userId) ? `${baseKey}:user:${userId}` : null;
}

function readMigratedUserStorageValue(baseKey: string): { key: string | null; value: string } {
  const key = getUserStorageKey(baseKey);
  if (!key) return { key: null, value: "" };
  try {
    const scopedValue = localStorage.getItem(key);
    const legacyValue = localStorage.getItem(baseKey);
    if (scopedValue !== null) {
      if (legacyValue !== null) localStorage.removeItem(baseKey);
      return { key, value: scopedValue };
    }
    if (legacyValue !== null) {
      localStorage.setItem(key, legacyValue);
      localStorage.removeItem(baseKey);
      return { key, value: legacyValue };
    }
  } catch {
    return { key, value: "" };
  }
  return { key, value: "" };
}

function readActiveSessionId(): number {
  return Number(readMigratedUserStorageValue(ACTIVE_SESSION_KEY).value || "");
}

function writeActiveSessionId(sessionId: number) {
  const key = getUserStorageKey(ACTIVE_SESSION_KEY);
  if (!key) return;
  try {
    localStorage.setItem(key, String(sessionId));
  } catch {
    // Session navigation still works without persistence.
  }
}

function clearActiveSessionId() {
  const key = getUserStorageKey(ACTIVE_SESSION_KEY);
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Session navigation still works without persistence.
  }
}

function parseAssistantContent(content: string): ParsedAssistantContent {
  const thought = content.match(/<ai_thought_summary>\s*([\s\S]*?)\s*<\/ai_thought_summary>/i)?.[1]?.trim() ?? "";
  const completeAnswer = content.match(/<ai_answer>\s*([\s\S]*?)\s*<\/ai_answer>/i)?.[1]?.trim() ?? "";
  if (completeAnswer) return { thought, answer: completeAnswer };

  const streamingAnswer = content.match(/<ai_answer>\s*([\s\S]*)$/i);
  if (streamingAnswer) {
    return { thought, answer: (streamingAnswer[1] ?? "").replace(/<\/ai_[a-z_]*>?[\s\S]*$/i, "") };
  }

  const streamingThought = content.match(/<ai_thought_summary>\s*([\s\S]*)$/i);
  if (streamingThought) {
    return {
      thought: (streamingThought[1] ?? "").replace(/<\/ai_[a-z_]*>?[\s\S]*$/i, "").trim(),
      answer: ""
    };
  }
  if (/^\s*<ai_[a-z_]*>?\s*$/i.test(content)) return { thought: "", answer: "" };
  return { thought: "", answer: content };
}

function normalizeMathDelimiters(content: string) {
  return content
    .replace(/\\\[((?:.|\n)*?)\\\]/g, (_match, formula: string) => `\n\n$$\n${formula.trim()}\n$$\n\n`)
    .replace(/\\\(((?:.|\n)*?)\\\)/g, (_match, formula: string) => `$${formula.trim()}$`)
    .replace(/(^|\n)\s*\[\s*([^\]\n]*(?:\\[a-zA-Z]+|[=^_{}+\-*/]|[a-zA-Z]\s*\^)[^\]\n]*)\s*\]\s*(?=\n|$)/g, (_match, prefix: string, formula: string) => {
      return `${prefix}\n$$\n${formula.trim()}\n$$\n`;
    });
}

function MarkdownContent({ content, compact = false }: { content: string; compact?: boolean }) {
  const normalizedContent = normalizeMathDelimiters(content);

  return (
    <div className={cn("markdown-body", compact && "markdown-body-compact")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          code: ({ className, children, ...props }) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code className="rounded-md bg-black/[0.06] px-1.5 py-0.5 text-[0.92em] dark:bg-white/[0.08]" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }
        }}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
}

export function ChatPanel() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamHasContent, setStreamHasContent] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<number | null>(null);
  const [updatingSessionId, setUpdatingSessionId] = useState<number | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
  const [editingSessionTitle, setEditingSessionTitle] = useState("");
  const [sessionQuery, setSessionQuery] = useState("");
  const [pendingJobs, setPendingJobs] = useState<ChatJob[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [provider, setProvider] = useState<Provider>("openai");
  const [chatModels, setChatModels] = useState<ChatModel[]>([]);
  const [model, setModel] = useState("");
  const [modelsLoading, setModelsLoading] = useState(true);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [exportingMessageIndex, setExportingMessageIndex] = useState<number | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const pollingRef = useRef(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const draftReadyRef = useRef(false);
  const draftStorageKeyRef = useRef<string | null>(null);
  const pendingPromptCommitRef = useRef<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const activeSessionIdRef = useRef<number | null>(null);
  const sessionRequestSequenceRef = useRef(0);
  const openingSessionIdRef = useRef<number | null>(null);
  const router = useRouter();

  const lastUserMessage = useMemo(() => [...messages].reverse().find((item) => item.role === "user")?.content, [messages]);
  const availableModels = useMemo(() => chatModels.filter((item) => item.provider === provider), [chatModels, provider]);
  const activePendingJob = useMemo(() => pendingJobs.find((job) => job.session_id === activeSessionId), [activeSessionId, pendingJobs]);
  const respondingProvider = activePendingJob?.provider ?? provider;
  const respondingModelId = activePendingJob?.model ?? model;
  const respondingModel = chatModels.find((item) => item.provider === respondingProvider && item.model_id === respondingModelId);
  const isBusy = loading || streaming;
  const latestMessageContent = messages.at(-1)?.content ?? "";
  const filteredSessions = useMemo(() => {
    const query = sessionQuery.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((session) => session.title.toLowerCase().includes(query));
  }, [sessionQuery, sessions]);

  useEffect(() => {
    if (!getAuthToken()) {
      router.push("/login");
      return;
    }

    const storedProvider = localStorage.getItem(CHAT_PROVIDER_KEY);
    setFocusMode(localStorage.getItem(CHAT_FOCUS_KEY) === "true");
    if (storedProvider === "openai" || storedProvider === "grok" || storedProvider === "gork") {
      const normalizedProvider = storedProvider === "gork" ? "grok" : storedProvider;
      setProvider(normalizedProvider);
      localStorage.setItem(CHAT_PROVIDER_KEY, normalizedProvider);
    }

    const storedSessionId = readActiveSessionId();
    const storedDraft = readMigratedUserStorageValue(CHAT_DRAFT_KEY);
    draftStorageKeyRef.current = storedDraft.key;
    const templatePrompt = new URLSearchParams(window.location.search).get("prompt");
    let initialPrompt = "";
    let incomingPromptRejected = false;
    let initialPromptIsDraft = false;
    if (templatePrompt) {
      const normalizedTemplatePrompt = templatePrompt.trim();
      if (normalizedTemplatePrompt.length > CHAT_PROMPT_LIMIT) {
        incomingPromptRejected = true;
        toast.error(`传入的 Prompt 超过 ${CHAT_PROMPT_LIMIT} 个字符，未载入输入区。`);
      } else {
        initialPrompt = normalizedTemplatePrompt;
      }
    }
    if (!initialPrompt && !incomingPromptRejected && pendingPromptCommitRef.current) {
      initialPrompt = pendingPromptCommitRef.current;
    }
    if (!initialPrompt && !incomingPromptRejected) {
      try {
        const rawPending = sessionStorage.getItem(PENDING_PROMPT_KEY);
        const pending = JSON.parse(rawPending ?? "null") as { prompt?: unknown; target?: unknown; workflowId?: unknown } | null;
        if (pending?.target === "chat" && typeof pending.prompt === "string") {
          const normalizedPendingPrompt = pending.prompt.trim();
          if (!normalizedPendingPrompt) {
            sessionStorage.removeItem(PENDING_PROMPT_KEY);
          } else if (normalizedPendingPrompt.length > CHAT_PROMPT_LIMIT) {
            incomingPromptRejected = true;
            sessionStorage.removeItem(PENDING_PROMPT_KEY);
            toast.error(`工作流 Prompt 超过 ${CHAT_PROMPT_LIMIT} 个字符，未载入输入区。`);
          } else {
            initialPrompt = normalizedPendingPrompt;
            pendingPromptCommitRef.current = normalizedPendingPrompt;
          }
        } else if (rawPending && (typeof pending?.prompt !== "string" || (pending?.target !== "chat" && pending?.target !== "image"))) {
          sessionStorage.removeItem(PENDING_PROMPT_KEY);
        }
      } catch {
        sessionStorage.removeItem(PENDING_PROMPT_KEY);
      }
    }
    if (!initialPrompt && !incomingPromptRejected) {
      initialPrompt = storedDraft.value.trim();
      initialPromptIsDraft = Boolean(initialPrompt);
    }
    if (initialPrompt) {
      if (initialPrompt.length > CHAT_PROMPT_LIMIT) {
        toast.error(`已保存的对话草稿超过 ${CHAT_PROMPT_LIMIT} 个字符，请精简后再发送。`);
        if (initialPromptIsDraft) setInput(initialPrompt);
      } else {
        setInput(initialPrompt);
      }
    }
    draftReadyRef.current = true;
    if (templatePrompt) {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("prompt");
      window.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
    }
    const storedJobs = readPendingJobs();
    setPendingJobs(storedJobs);
    refreshChatModels();
    refreshSessions();
    if (storedSessionId) {
      openSession(storedSessionId, true, !initialPrompt);
    }
  }, [router]);

  useEffect(() => {
    const insertPrompt = (event: Event) => {
      const detail = (event as CustomEvent<{ prompt?: unknown; target?: unknown }>).detail;
      if (detail?.target !== "chat" || typeof detail.prompt !== "string") return;
      sessionStorage.removeItem(PENDING_PROMPT_KEY);
      const normalizedPrompt = detail.prompt.trim();
      if (normalizedPrompt.length > CHAT_PROMPT_LIMIT) {
        toast.error(`Prompt 超过 ${CHAT_PROMPT_LIMIT} 个字符，未载入输入区。`);
        return;
      }
      setInput(normalizedPrompt);
      toast.success("灵感已送入对话输入区");
    };
    window.addEventListener(PROMPT_INSERT_EVENT, insertPrompt);
    return () => window.removeEventListener(PROMPT_INSERT_EVENT, insertPrompt);
  }, []);

  useEffect(() => {
    if (!draftReadyRef.current) return;
    const key = draftStorageKeyRef.current;
    if (key) {
      try {
        if (input) localStorage.setItem(key, input);
        else localStorage.removeItem(key);
      } catch {
        // Keep the composer usable when browser storage is unavailable.
      }
    }

    const committedPrompt = pendingPromptCommitRef.current;
    if (!committedPrompt || input !== committedPrompt) return;
    try {
      const pending = JSON.parse(sessionStorage.getItem(PENDING_PROMPT_KEY) ?? "null") as { prompt?: unknown; target?: unknown } | null;
      if (pending?.target === "chat" && typeof pending.prompt === "string" && pending.prompt.trim() === committedPrompt) {
        sessionStorage.removeItem(PENDING_PROMPT_KEY);
      }
    } catch {
      sessionStorage.removeItem(PENDING_PROMPT_KEY);
    }
    pendingPromptCommitRef.current = null;
  }, [input]);

  function toggleFocusMode() {
    setFocusMode((current) => {
      const next = !current;
      localStorage.setItem(CHAT_FOCUS_KEY, String(next));
      return next;
    });
  }

  function insertPowerPrompt(prompt: string) {
    const normalized = prompt.trim();
    if (!normalized) return;
    if (normalized.length > CHAT_PROMPT_LIMIT) {
      toast.error(`生成内容超过 ${CHAT_PROMPT_LIMIT} 个字符，未载入输入区。`);
      return;
    }
    setInput(normalized);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  useEffect(() => {
    if (modelsLoading) return;
    if (availableModels.length === 0) {
      setModel("");
      return;
    }

    const storedModel = localStorage.getItem(`${CHAT_MODEL_KEY_PREFIX}${provider}`) ?? "";
    const nextModel =
      availableModels.find((item) => item.model_id === storedModel)?.model_id ??
      availableModels.find((item) => item.is_default)?.model_id ??
      availableModels[0].model_id;

    localStorage.setItem(`${CHAT_MODEL_KEY_PREFIX}${provider}`, nextModel);
    setModel(nextModel);
  }, [availableModels, modelsLoading, provider]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth", block: "end" });
  }, [messages.length, latestMessageContent, loading, streaming]);

  useEffect(() => {
    return () => streamAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (pendingJobs.length === 0) return;
    const timer = window.setInterval(() => {
      pollPendingJobs();
    }, 1800);
    pollPendingJobs();
    return () => window.clearInterval(timer);
  }, [pendingJobs.length, activeSessionId]);

  async function pollPendingJobs() {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      const jobs = readPendingJobs();
      if (jobs.length === 0) {
        setPendingJobs([]);
        setLoading(false);
        return;
      }

      const nextJobs: ChatJob[] = [];
      const settledSessionIds = new Set<number>();

      for (const job of jobs) {
        try {
          const latest = await getChatJob(job.id);
          if (latest.status === "completed") {
            settledSessionIds.add(latest.session_id);
          } else if (latest.status === "failed") {
            toast.error(latest.error || "AI 回复失败，请稍后重试。");
            settledSessionIds.add(latest.session_id);
          } else {
            nextJobs.push(latest);
          }
        } catch (error) {
          if (!(error instanceof ApiError) || ![401, 404].includes(error.status)) nextJobs.push(job);
        }
      }

      writePendingJobs(nextJobs);
      setPendingJobs(nextJobs);
      const currentSessionId = activeSessionIdRef.current;
      setLoading(nextJobs.some((job) => job.session_id === currentSessionId));

      if (currentSessionId && settledSessionIds.has(currentSessionId)) {
        await openSession(currentSessionId, false, false);
        await refreshSessions();
      }
    } finally {
      pollingRef.current = false;
    }
  }

  async function refreshSessions() {
    setSessionsLoading(true);
    try {
      setSessions(await getChatSessions());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载会话失败。");
    } finally {
      setSessionsLoading(false);
    }
  }

  async function refreshChatModels() {
    setModelsLoading(true);
    try {
      setChatModels(await getChatModels());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载模型失败。");
    } finally {
      setModelsLoading(false);
    }
  }

  async function openSession(sessionId: number, showLoading = true, clearComposer = true) {
    const requestSequence = ++sessionRequestSequenceRef.current;
    openingSessionIdRef.current = sessionId;
    if (showLoading) setLoading(true);
    try {
      const detail = await getChatSession(sessionId);
      if (requestSequence !== sessionRequestSequenceRef.current) return;
      updateActiveSessionId(sessionId);
      writeActiveSessionId(sessionId);
      if (clearComposer) setInput("");
      setSelectedFiles([]);
      setMessages(detail.messages.map((item) => ({ role: item.role, content: item.content })));
      setLoading(readPendingJobs().some((job) => job.session_id === sessionId));
    } catch (error) {
      if (requestSequence !== sessionRequestSequenceRef.current) return;
      if (error instanceof ApiError && error.status === 404) {
        clearActiveSessionId();
        updateActiveSessionId(null);
        setMessages([]);
        await refreshSessions();
      }
      toast.error(error instanceof Error ? error.message : "打开会话失败。");
    } finally {
      if (requestSequence === sessionRequestSequenceRef.current) {
        openingSessionIdRef.current = null;
        if (showLoading && !readPendingJobs().some((job) => job.session_id === sessionId)) setLoading(false);
      }
    }
  }

  function changeProvider(value: Provider) {
    setProvider(value);
    localStorage.setItem(CHAT_PROVIDER_KEY, value);
    const providerModels = chatModels.filter((item) => item.provider === value);
    const storedModel = localStorage.getItem(`${CHAT_MODEL_KEY_PREFIX}${value}`) ?? "";
    const nextModel =
      providerModels.find((item) => item.model_id === storedModel)?.model_id ??
      providerModels.find((item) => item.is_default)?.model_id ??
      providerModels[0]?.model_id ??
      "";
    setModel(nextModel);
    if (nextModel) localStorage.setItem(`${CHAT_MODEL_KEY_PREFIX}${value}`, nextModel);
  }

  function updateActiveSessionId(sessionId: number | null) {
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
  }

  function changeModel(value: string) {
    setModel(value);
    if (value) localStorage.setItem(`${CHAT_MODEL_KEY_PREFIX}${provider}`, value);
  }

  function startNewChat() {
    if (streaming) return;
    sessionRequestSequenceRef.current += 1;
    openingSessionIdRef.current = null;
    updateActiveSessionId(null);
    clearActiveSessionId();
    setMessages([]);
    setInput("");
    setSelectedFiles([]);
    setLoading(false);
  }

  function stopStreaming() {
    streamAbortRef.current?.abort();
  }

  function beginEditingSession(session: ChatSession) {
    setEditingSessionId(session.id);
    setEditingSessionTitle(session.title);
  }

  function cancelEditingSession() {
    if (updatingSessionId !== null) return;
    setEditingSessionId(null);
    setEditingSessionTitle("");
  }

  async function saveSessionTitle(sessionId: number) {
    const title = editingSessionTitle.trim();
    if (!title) {
      toast.error("会话名称不能为空。");
      return;
    }
    if (title.length > 160) {
      toast.error("会话名称不能超过 160 个字符。");
      return;
    }

    const current = sessions.find((session) => session.id === sessionId);
    if (current?.title === title) {
      cancelEditingSession();
      return;
    }

    setUpdatingSessionId(sessionId);
    try {
      const updated = await updateChatSession(sessionId, title);
      setSessions((items) => items.map((item) => (item.id === sessionId ? updated : item)));
      setEditingSessionId(null);
      setEditingSessionTitle("");
      toast.success("会话名称已更新。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重命名失败，请稍后重试。");
    } finally {
      setUpdatingSessionId(null);
    }
  }

  async function deleteSession(sessionId: number) {
    if (streaming) return;
    const session = sessions.find((item) => item.id === sessionId);
    const ok = window.confirm(`确定删除「${session?.title ?? "当前会话"}」吗？删除后无法恢复。`);
    if (!ok) return;

    if (openingSessionIdRef.current === sessionId) {
      sessionRequestSequenceRef.current += 1;
      openingSessionIdRef.current = null;
    }

    setDeletingSessionId(sessionId);
    try {
      await deleteChatSession(sessionId);
      if (openingSessionIdRef.current === sessionId) {
        sessionRequestSequenceRef.current += 1;
        openingSessionIdRef.current = null;
      }
      const nextJobs = readPendingJobs().filter((job) => job.session_id !== sessionId);
      writePendingJobs(nextJobs);
      setPendingJobs(nextJobs);

      if (activeSessionIdRef.current === sessionId) {
        clearActiveSessionId();
        updateActiveSessionId(null);
        setMessages([]);
        setInput("");
        setSelectedFiles([]);
        setLoading(false);
      } else {
        setLoading(nextJobs.some((job) => job.session_id === activeSessionIdRef.current));
      }

      setSessions((prev) => prev.filter((item) => item.id !== sessionId));
      await refreshSessions();
      toast.success("会话已删除。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除会话失败。");
    } finally {
      setDeletingSessionId(null);
    }
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const next = [...selectedFiles, ...Array.from(fileList)];
    const unique = next.filter((file, index, array) => array.findIndex((item) => item.name === file.name && item.size === file.size) === index);
    setSelectedFiles(unique.slice(0, 5));
    if (unique.length > 5) toast.warning("一次最多上传 5 个附件。");
  }

  function removeFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }

  async function submit(message = input, files = selectedFiles) {
    if (isBusy || streamAbortRef.current) return;
    const trimmed = message.trim();
    if (!trimmed && files.length === 0) return;
    if (trimmed.length > 4000) {
      toast.error("输入不能超过 4000 字。");
      return;
    }
    if (files.length > 5) {
      toast.error("一次最多上传 5 个附件。");
      return;
    }

    setInput("");
    setSelectedFiles([]);

    const fallbackMessage = trimmed || "请分析这些附件。";
    const attachmentText = files.length ? `\n\n附件：${files.map((file) => file.name).join(", ")}` : "";
    const previousMessages = messages;
    setMessages((prev) => [...prev, { role: "user", content: `${fallbackMessage}${attachmentText}` }]);

    if (files.length > 0) {
      setLoading(true);
      try {
        const job = await createChatJob(fallbackMessage, activeSessionId, files, provider, model || undefined);
        updateActiveSessionId(job.session_id);
        writeActiveSessionId(job.session_id);
        const jobs = [...readPendingJobs().filter((item) => item.id !== job.id), job];
        writePendingJobs(jobs);
        setPendingJobs(jobs);
        await refreshSessions();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "AI 回复失败，请稍后重试。");
        setMessages(previousMessages);
        setInput(trimmed);
        setSelectedFiles(files);
        setLoading(false);
      }
      return;
    }

    const controller = new AbortController();
    const streamMessageId = `stream-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let resolvedSessionId = activeSessionId;
    let receivedText = "";
    streamAbortRef.current = controller;
    setStreamHasContent(false);
    setStreaming(true);

    try {
      await streamChat({
        message: fallbackMessage,
        sessionId: activeSessionId,
        provider,
        model: model || undefined,
        signal: controller.signal,
        onSessionId: (sessionId) => {
          resolvedSessionId = sessionId;
          updateActiveSessionId(sessionId);
          writeActiveSessionId(sessionId);
        },
        onDelta: (text) => {
          receivedText += text;
          const nextContent = receivedText;
          setStreamHasContent(true);
          setMessages((items) => {
            const streamIndex = items.findIndex((item) => item.streamId === streamMessageId);
            if (streamIndex < 0) {
              return [...items, { role: "assistant", content: nextContent, streamId: streamMessageId }];
            }
            const next = [...items];
            next[streamIndex] = { ...next[streamIndex], content: nextContent };
            return next;
          });
        }
      });

      if (resolvedSessionId) await openSession(resolvedSessionId, false);
      await refreshSessions();
    } catch (error) {
      const wasAborted = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
      if (wasAborted) {
        if (!receivedText && resolvedSessionId) await openSession(resolvedSessionId, false);
        if (!receivedText && !resolvedSessionId) {
          setMessages(previousMessages);
          setInput(trimmed);
        }
        toast.info(receivedText ? "已停止生成，当前内容已保留。" : "已停止生成。");
        await refreshSessions();
      } else {
        toast.error(error instanceof Error ? error.message : "AI 回复失败，请稍后重试。");
        setInput(trimmed);
        const authExpired = error instanceof ApiError && error.status === 401;
        if (authExpired) {
          setMessages(previousMessages);
        } else if (resolvedSessionId) {
          try {
            const detail = await getChatSession(resolvedSessionId);
            setMessages(detail.messages.map((item) => ({ role: item.role, content: item.content })));
          } catch (sessionError) {
            if (sessionError instanceof ApiError && sessionError.status === 404) {
              clearActiveSessionId();
              updateActiveSessionId(null);
              setMessages([]);
            } else {
              setMessages(previousMessages);
            }
          }
        } else {
          setMessages(previousMessages);
        }
        if (!authExpired) await refreshSessions();
      }
    } finally {
      if (streamAbortRef.current === controller) streamAbortRef.current = null;
      setStreaming(false);
      setStreamHasContent(false);
    }
  }

  async function copyText(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageIndex(index);
      toast.success("已复制回答内容。");
      window.setTimeout(() => setCopiedMessageIndex((current) => (current === index ? null : current)), 1400);
    } catch {
      toast.error("复制失败，请手动选择文本复制。");
    }
  }

  async function exportWord(text: string, index: number) {
    setExportingMessageIndex(index);
    try {
      await downloadChatAnswerWord(text);
      toast.success("Word 文档已开始下载。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出 Word 失败。");
    } finally {
      setExportingMessageIndex(null);
    }
  }

  function renderAssistantMessage(content: string, index: number) {
    const parsed = parseAssistantContent(content);
    const isCopied = copiedMessageIndex === index;
    const isExporting = exportingMessageIndex === index;
    const isActiveStream = streaming && index === messages.length - 1;

    return (
      <div className="w-full min-w-0">
        <div className="mb-3 flex justify-end gap-1">
          {isActiveStream ? (
            <span className="inline-flex h-8 items-center gap-2 rounded-md border border-[#2DD4BF]/25 bg-[#2DD4BF]/8 px-2.5 text-[10px] font-semibold uppercase text-[#14B8A6]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2DD4BF]" />
              Streaming
            </span>
          ) : (
            <>
              <MessageBranchButton messageIndex={index} disabled={isBusy} />
              <AnswerActionBar answer={parsed.answer} onInsertPrompt={insertPowerPrompt} />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-lg"
                onClick={() => copyText(parsed.answer, index)}
                aria-label="复制回答"
                title="复制回答"
              >
                {isCopied ? <Check className="h-3.5 w-3.5 text-[#5B7CFF]" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-lg"
                onClick={() => exportWord(parsed.answer, index)}
                disabled={isExporting}
                aria-label="导出 Word"
                title="导出 Word"
              >
                {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[#5B7CFF]" /> : <FileDown className="h-3.5 w-3.5" />}
              </Button>
            </>
          )}
        </div>

        {parsed.thought && (
          <details open={isActiveStream || undefined} className="mb-3 rounded-xl border border-[#5B7CFF]/20 bg-[#5B7CFF]/5 px-3 py-2">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-[#5B7CFF]">
              <Brain className="h-3.5 w-3.5" />
              思考摘要
            </summary>
            <div className="mt-2 text-muted-foreground">
              <MarkdownContent content={parsed.thought} compact />
            </div>
          </details>
        )}

        {parsed.answer ? (
          <MarkdownContent content={parsed.answer} />
        ) : isActiveStream ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#5B7CFF]" />
            正在组织正文...
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <PageShell>
      <div className={cn("grid gap-4 lg:gap-5 xl:h-[calc(100dvh-10rem)] xl:min-h-[520px]", !focusMode && "xl:grid-cols-[minmax(0,1fr)_360px]")}>
        <Card className="flex h-[calc(100dvh-13.25rem)] min-h-[620px] flex-col overflow-hidden sm:h-[calc(100dvh-10rem)] sm:min-h-[680px] xl:h-full xl:min-h-0">
          <div className="flex shrink-0 flex-col items-start gap-3 border-b border-border px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex w-full min-w-0 items-start justify-between gap-3 sm:block sm:w-auto">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">GPT 智能对话</h2>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">OpenAI / Grok · Markdown · 公式 · 附件分析</p>
              </div>
              <Button variant="secondary" size="icon" className="shrink-0 sm:hidden" disabled={streaming} onClick={startNewChat} aria-label="新对话">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
              <div className="flex rounded-xl border border-border bg-background/70 p-1">
                {providers.map((item) => (
                  <button
                    key={item.value}
                    onClick={() => changeProvider(item.value)}
                    disabled={isBusy}
                    className={cn(
                      "h-8 rounded-lg px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
                      provider === item.value ? "bg-[#5B7CFF] text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <select
                aria-label={`${provider === "grok" ? "Grok" : "OpenAI"} 模型`}
                title={availableModels.find((item) => item.model_id === model)?.model_id ?? "选择模型"}
                value={model}
                disabled={isBusy || modelsLoading || availableModels.length === 0}
                onChange={(event) => changeModel(event.target.value)}
                className="h-10 min-w-[135px] max-w-[220px] flex-1 rounded-xl border border-border bg-background/70 px-3 text-xs font-semibold outline-none transition focus:border-[#5B7CFF] focus:ring-2 focus:ring-[#5B7CFF]/15 disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-[150px] sm:flex-none"
              >
                {modelsLoading ? (
                  <option value="">加载模型中...</option>
                ) : availableModels.length === 0 ? (
                  <option value="">暂无可用模型</option>
                ) : (
                  availableModels.map((item) => (
                    <option key={item.id} value={item.model_id}>
                      {item.display_name}
                      {item.is_default ? "（默认）" : ""}
                    </option>
                  ))
                )}
              </select>
              <ChatPowerTools
                messages={messages}
                models={chatModels}
                activeSessionId={activeSessionId}
                provider={provider}
                model={model}
                composerText={input}
                disabled={isBusy}
                onInsertPrompt={insertPowerPrompt}
              />
              <Button variant="secondary" size="sm" className="hidden sm:inline-flex" disabled={streaming} onClick={startNewChat} aria-label="新对话">
                <Plus className="h-4 w-4" />
                <span>新对话</span>
              </Button>
              <Button variant="secondary" size="icon" className="hidden xl:inline-flex" onClick={toggleFocusMode} aria-label={focusMode ? "退出专注模式" : "进入专注模式"} title={focusMode ? "显示会话栏" : "隐藏会话栏"}>
                {focusMode ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="soft-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5">
            <div className="mx-auto flex w-full max-w-none flex-col gap-4">
              {messages.length === 0 ? (
                <div className="grid min-h-[240px] flex-1 place-items-center text-center">
                  <div className="max-w-lg">
                    <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#5B7CFF]/10 text-[#5B7CFF]">
                      <SendHorizontal className="h-6 w-6" />
                    </div>
                    <h3 className="mt-5 text-xl font-semibold">开始一次新的 AI 对话</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      输入问题，或上传图片、文档、表格等附件，让 AI 帮你分析、写作、归纳和创作。
                    </p>
                  </div>
                </div>
              ) : (
                messages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className={cn("flex w-full", message.role === "user" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "text-sm leading-6",
                        message.role === "user"
                          ? "chat-user-bubble w-fit max-w-[min(100%,42rem)] rounded-2xl rounded-br-md bg-[#5B7CFF] px-4 py-3 text-white shadow-sm sm:px-5"
                          : "chat-assistant-bubble w-full max-w-full rounded-2xl rounded-bl-md border border-border bg-background/80 px-4 py-3.5 shadow-sm sm:px-5 sm:py-4"
                      )}
                    >
                      {message.role === "assistant" ? (
                        renderAssistantMessage(message.content, index)
                      ) : (
                        <div>
                          <div className="mb-1 flex justify-end">
                            <MessageBranchButton messageIndex={index} disabled={isBusy} className="text-white/75 hover:bg-white/10 hover:text-white" />
                          </div>
                          <div className="whitespace-pre-wrap break-words">{message.content}</div>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}

              {(loading || (streaming && !streamHasContent)) && (
                <div className="flex w-full justify-start">
                  <div className="inline-flex items-center gap-3 rounded-2xl border border-border bg-background/80 px-4 py-3 text-sm text-muted-foreground shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-[#5B7CFF]" />
                    AI 正在通过 {respondingProvider === "grok" ? "Grok" : "OpenAI"}
                    {respondingModelId ? ` · ${respondingModel?.display_name ?? respondingModelId}` : ""} 生成回答...
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="shrink-0 border-t border-border bg-card/40 px-4 py-3.5 sm:px-5">
            <div className="flex flex-col gap-3">
              {selectedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedFiles.map((file, index) => (
                    <div key={`${file.name}-${file.size}`} className="inline-flex max-w-full items-center gap-2 rounded-xl border border-border bg-background/70 px-3 py-2 text-xs">
                      <FileText className="h-3.5 w-3.5 text-[#5B7CFF]" />
                      <span className="max-w-[220px] truncate">{file.name}</span>
                      <button className="rounded-md p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground" onClick={() => removeFile(index)} aria-label="移除附件">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <Textarea
                ref={composerRef}
                value={input}
                maxLength={4000}
                disabled={isBusy}
                className="min-h-[96px]"
                placeholder="输入你的问题。Enter 发送，Shift + Enter 换行。"
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <input
                    id="chat-attachments"
                    type="file"
                    multiple
                    disabled={isBusy}
                    accept={FILE_ACCEPT}
                    className="hidden"
                    onChange={(event) => {
                      addFiles(event.target.files);
                      event.currentTarget.value = "";
                    }}
                  />
                  <Button asChild variant="secondary" size="icon" aria-label="上传附件" className={cn(isBusy && "pointer-events-none opacity-50")}>
                    <label htmlFor="chat-attachments" className="cursor-pointer" aria-disabled={isBusy}>
                      <Paperclip className="h-4 w-4" />
                    </label>
                  </Button>
                  <WorkflowPicker
                    target="chat"
                    buttonLabel="工作流"
                    disabled={isBusy}
                    onApply={(prompt) => {
                      const normalizedPrompt = prompt.trim();
                      if (normalizedPrompt.length > CHAT_PROMPT_LIMIT) {
                        toast.error(`工作流编译结果超过 ${CHAT_PROMPT_LIMIT} 个字符，请精简变量后重试。`);
                        return;
                      }
                      setInput(normalizedPrompt);
                    }}
                  />
                  {input ? <span className="inline-flex items-center gap-1 text-[10px] text-[#2DD4BF]"><Save className="h-3 w-3" />草稿已存</span> : null}
                  <span className="text-xs tabular-nums text-muted-foreground">{input.length}/4000</span>
                </div>
                <div className="flex w-full gap-2 sm:w-auto">
                  <Button className="flex-1 sm:flex-none" variant="secondary" disabled={!lastUserMessage || isBusy} onClick={() => lastUserMessage && submit(lastUserMessage, [])}>
                    <RefreshCcw className="h-4 w-4" />
                    重新生成
                  </Button>
                  {streaming ? (
                    <Button
                      variant="secondary"
                      className="flex-1 border-red-500/35 bg-red-500/5 text-red-500 hover:border-red-500/55 hover:bg-red-500/10 sm:flex-none"
                      onClick={stopStreaming}
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                      停止生成
                    </Button>
                  ) : (
                    <Button className="flex-1 sm:flex-none" disabled={loading || (!input.trim() && selectedFiles.length === 0)} onClick={() => submit()}>
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
                      发送
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card className={cn("flex min-h-[420px] flex-col overflow-hidden p-4 sm:p-5 xl:h-full xl:min-h-0", focusMode && "xl:hidden")}>
          <div className="flex shrink-0 items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">最近会话</h3>
              <p className="mt-1 text-xs text-muted-foreground">显示最近 10 条，可继续原来的对话。</p>
            </div>
            <Button variant="secondary" size="icon" disabled={streaming} onClick={startNewChat} aria-label="新对话">
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="relative mt-3 shrink-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={sessionQuery}
              onChange={(event) => setSessionQuery(event.target.value)}
              placeholder="搜索已加载会话"
              aria-label="搜索会话"
              className="h-10 w-full rounded-md border border-border bg-background/70 pl-9 pr-3 text-xs outline-none transition placeholder:text-muted-foreground/60 focus:border-[#5B7CFF]/60 focus:ring-2 focus:ring-[#5B7CFF]/10"
            />
          </div>

          <div className="soft-scrollbar mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-0.5">
            {sessionsLoading ? (
              <div className="flex items-center gap-2 rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-[#5B7CFF]" />
                加载会话中...
              </div>
            ) : sessions.length === 0 ? (
              <div className="grid min-h-[200px] place-items-center rounded-2xl border border-dashed border-border bg-background/60 text-center">
                <div>
                  <MessageSquareText className="mx-auto h-6 w-6 text-[#5B7CFF]" />
                  <p className="mt-3 text-sm font-medium">暂无历史会话</p>
                  <p className="mt-1 text-xs text-muted-foreground">发送第一条消息后，这里会自动保存。</p>
                </div>
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="grid min-h-[160px] place-items-center rounded-2xl border border-dashed border-border bg-background/60 text-center">
                <div>
                  <Search className="mx-auto h-5 w-5 text-muted-foreground" />
                  <p className="mt-3 text-sm font-medium">没有匹配的会话</p>
                  <p className="mt-1 text-xs text-muted-foreground">换个关键词再试。</p>
                </div>
              </div>
            ) : (
              filteredSessions.map((session) => (
                <div
                  key={session.id}
                  className={cn(
                    "group flex w-full items-start gap-2 rounded-2xl border border-border bg-background/70 p-3 text-left transition hover:border-[#5B7CFF]/45",
                    activeSessionId === session.id && "border-[#5B7CFF] bg-[#5B7CFF]/10"
                  )}
                >
                  {editingSessionId === session.id ? (
                    <form
                      className="flex min-w-0 flex-1 items-start gap-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveSessionTitle(session.id);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <input
                          autoFocus
                          value={editingSessionTitle}
                          maxLength={160}
                          disabled={updatingSessionId === session.id}
                          onChange={(event) => setEditingSessionTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              cancelEditingSession();
                            }
                          }}
                          aria-label="会话名称"
                          className="h-8 w-full rounded-md border border-[#5B7CFF]/45 bg-background px-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-[#5B7CFF]/15"
                        />
                        <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Clock3 className="h-3 w-3" />
                          Enter 保存 · Esc 取消
                        </div>
                      </div>
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-[#5B7CFF]"
                        disabled={updatingSessionId === session.id}
                        aria-label="保存会话名称"
                        title="保存"
                      >
                        {updatingSessionId === session.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        disabled={updatingSessionId === session.id}
                        onClick={cancelEditingSession}
                        aria-label="取消重命名"
                        title="取消"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </form>
                  ) : (
                    <>
                      <button className="min-w-0 flex-1 text-left disabled:cursor-not-allowed" disabled={streaming} onClick={() => openSession(session.id)}>
                        <div className="line-clamp-2 text-sm font-semibold">{session.title}</div>
                        <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock3 className="h-3.5 w-3.5" />
                          {new Date(session.updated_at).toLocaleString()}
                        </div>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground opacity-70 transition hover:bg-[#5B7CFF]/10 hover:text-[#5B7CFF] group-hover:opacity-100"
                        disabled={streaming || updatingSessionId !== null}
                        onClick={() => beginEditingSession(session)}
                        aria-label="重命名会话"
                        title="重命名"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground opacity-70 transition hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                        disabled={streaming || deletingSessionId === session.id}
                        onClick={() => deleteSession(session.id)}
                        aria-label="删除会话"
                        title="删除会话"
                      >
                        {deletingSessionId === session.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
