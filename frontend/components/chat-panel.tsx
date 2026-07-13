"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Brain, Clock3, Copy, FileText, Loader2, MessageSquareText, Paperclip, Plus, RefreshCcw, SendHorizontal, Trash2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { toast } from "sonner";

import {
  createChatJob,
  deleteChatSession,
  getAuthToken,
  getChatJob,
  getChatModels,
  getChatSession,
  getChatSessions,
  type ChatJob,
  type ChatModel,
  type ChatSession,
  type Provider
} from "@/lib/api";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type ParsedAssistantContent = {
  thought: string;
  answer: string;
};

const ACTIVE_SESSION_KEY = "aiweb_active_chat_session_id";
const PENDING_JOBS_KEY = "aiweb_pending_chat_jobs";
const CHAT_PROVIDER_KEY = "aiweb_chat_provider";
const CHAT_MODEL_KEY_PREFIX = "aiweb_chat_model_";
const FILE_ACCEPT = "image/*,.txt,.md,.csv,.json,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.py,.js,.jsx,.ts,.tsx,.html,.css,.xml,.yaml,.yml";
const providers: { label: string; value: Provider }[] = [
  { label: "OpenAI", value: "openai" },
  { label: "Grok", value: "grok" }
];

function readPendingJobs(): ChatJob[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(PENDING_JOBS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ChatJob[];
  } catch {
    return [];
  }
}

function writePendingJobs(jobs: ChatJob[]) {
  localStorage.setItem(PENDING_JOBS_KEY, JSON.stringify(jobs));
}

function parseAssistantContent(content: string): ParsedAssistantContent {
  const thought = content.match(/<ai_thought_summary>\s*([\s\S]*?)\s*<\/ai_thought_summary>/i)?.[1]?.trim() ?? "";
  const answer = content.match(/<ai_answer>\s*([\s\S]*?)\s*<\/ai_answer>/i)?.[1]?.trim() ?? "";
  if (answer) return { thought, answer };
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
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<number | null>(null);
  const [pendingJobs, setPendingJobs] = useState<ChatJob[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [provider, setProvider] = useState<Provider>("openai");
  const [chatModels, setChatModels] = useState<ChatModel[]>([]);
  const [model, setModel] = useState("");
  const [modelsLoading, setModelsLoading] = useState(true);
  const router = useRouter();
  const lastUserMessage = useMemo(() => [...messages].reverse().find((item) => item.role === "user")?.content, [messages]);
  const availableModels = useMemo(() => chatModels.filter((item) => item.provider === provider), [chatModels, provider]);
  const activePendingJob = useMemo(
    () => pendingJobs.find((job) => job.session_id === activeSessionId),
    [activeSessionId, pendingJobs]
  );
  const respondingProvider = activePendingJob?.provider ?? provider;
  const respondingModelId = activePendingJob?.model ?? model;
  const respondingModel = chatModels.find(
    (item) => item.provider === respondingProvider && item.model_id === respondingModelId
  );

  useEffect(() => {
    if (!getAuthToken()) {
      router.push("/login");
      return;
    }
    const storedProvider = localStorage.getItem(CHAT_PROVIDER_KEY);
    // Accept legacy misspelling "gork".
    if (storedProvider === "openai" || storedProvider === "grok" || storedProvider === "gork") {
      setProvider(storedProvider === "gork" ? "grok" : storedProvider);
      if (storedProvider === "gork") {
        localStorage.setItem(CHAT_PROVIDER_KEY, "grok");
      }
    }
    const storedSessionId = Number(localStorage.getItem(ACTIVE_SESSION_KEY) || "");
    const storedJobs = readPendingJobs();
    setPendingJobs(storedJobs);
    refreshChatModels();
    refreshSessions();
    if (storedSessionId) {
      openSession(storedSessionId);
    }
  }, [router]);

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
    if (pendingJobs.length === 0) return;
    const timer = window.setInterval(() => {
      pollPendingJobs();
    }, 1800);
    pollPendingJobs();
    return () => window.clearInterval(timer);
  }, [pendingJobs.length, activeSessionId]);

  async function pollPendingJobs() {
    const jobs = readPendingJobs();
    if (jobs.length === 0) {
      setPendingJobs([]);
      setLoading(false);
      return;
    }

    const nextJobs: ChatJob[] = [];
    let shouldReloadActiveSession = false;
    for (const job of jobs) {
      try {
        const latest = await getChatJob(job.id);
        if (latest.status === "completed") {
          shouldReloadActiveSession = shouldReloadActiveSession || latest.session_id === activeSessionId;
        } else if (latest.status === "failed") {
          toast.error(latest.error || "AI 回复失败。");
          shouldReloadActiveSession = shouldReloadActiveSession || latest.session_id === activeSessionId;
        } else {
          nextJobs.push(latest);
        }
      } catch {
        nextJobs.push(job);
      }
    }
    writePendingJobs(nextJobs);
    setPendingJobs(nextJobs);
    setLoading(nextJobs.some((job) => job.session_id === activeSessionId));
    if (shouldReloadActiveSession && activeSessionId) {
      await openSession(activeSessionId, false);
      await refreshSessions();
    }
  }

  async function refreshSessions() {
    setSessionsLoading(true);
    try {
      setSessions(await getChatSessions());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "会话历史加载失败。");
    } finally {
      setSessionsLoading(false);
    }
  }

  async function refreshChatModels() {
    setModelsLoading(true);
    try {
      setChatModels(await getChatModels());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "模型列表加载失败，将使用通道默认模型。");
    } finally {
      setModelsLoading(false);
    }
  }

  async function openSession(sessionId: number, showLoading = true) {
    if (showLoading) setLoading(true);
    try {
      const detail = await getChatSession(sessionId);
      setActiveSessionId(sessionId);
      localStorage.setItem(ACTIVE_SESSION_KEY, String(sessionId));
      setInput("");
      setSelectedFiles([]);
      setMessages(detail.messages.map((item) => ({ role: item.role, content: item.content })));
      setLoading(readPendingJobs().some((job) => job.session_id === sessionId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "会话读取失败。");
    } finally {
      if (showLoading && !readPendingJobs().some((job) => job.session_id === sessionId)) setLoading(false);
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

  function changeModel(value: string) {
    setModel(value);
    if (value) localStorage.setItem(`${CHAT_MODEL_KEY_PREFIX}${provider}`, value);
  }

  function startNewChat() {
    setActiveSessionId(null);
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    setMessages([]);
    setInput("");
    setSelectedFiles([]);
    setLoading(false);
  }

  async function deleteSession(sessionId: number) {
    const session = sessions.find((item) => item.id === sessionId);
    const ok = window.confirm(`确定删除「${session?.title ?? "这个会话"}」吗？删除后该会话内容无法恢复。`);
    if (!ok) return;

    setDeletingSessionId(sessionId);
    try {
      await deleteChatSession(sessionId);
      const nextJobs = readPendingJobs().filter((job) => job.session_id !== sessionId);
      writePendingJobs(nextJobs);
      setPendingJobs(nextJobs);

      if (activeSessionId === sessionId) {
        localStorage.removeItem(ACTIVE_SESSION_KEY);
        setActiveSessionId(null);
        setMessages([]);
        setInput("");
        setSelectedFiles([]);
        setLoading(false);
      } else {
        setLoading(nextJobs.some((job) => job.session_id === activeSessionId));
      }

      setSessions((prev) => prev.filter((item) => item.id !== sessionId));
      await refreshSessions();
      toast.success("会话已删除。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "会话删除失败。");
    } finally {
      setDeletingSessionId(null);
    }
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const next = [...selectedFiles, ...Array.from(fileList)];
    const unique = next.filter((file, index, array) => array.findIndex((item) => item.name === file.name && item.size === file.size) === index);
    setSelectedFiles(unique.slice(0, 5));
    if (unique.length > 5) toast.warning("已保留前 5 个附件。");
  }

  function removeFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }

  async function submit(message = input, files = selectedFiles) {
    const trimmed = message.trim();
    if (!trimmed && files.length === 0) return;
    if (trimmed.length > 4000) {
      toast.error("输入不能超过 4000 个字符。");
      return;
    }
    if (files.length > 5) {
      toast.error("一次最多上传 5 个附件。");
      return;
    }

    setLoading(true);
    setInput("");
    setSelectedFiles([]);
    const fallbackMessage = trimmed || "请分析这些附件。";
    const attachmentText = files.length ? `\n\n附件：${files.map((file) => file.name).join(", ")}` : "";
    setMessages((prev) => [...prev, { role: "user", content: `${fallbackMessage}${attachmentText}` }]);
    try {
      const job = await createChatJob(fallbackMessage, activeSessionId, files, provider, model || undefined);
      setActiveSessionId(job.session_id);
      localStorage.setItem(ACTIVE_SESSION_KEY, String(job.session_id));
      const jobs = [...readPendingJobs().filter((item) => item.id !== job.id), job];
      writePendingJobs(jobs);
      setPendingJobs(jobs);
      await refreshSessions();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI 回复失败。");
      setInput(trimmed);
      setSelectedFiles(files);
      setLoading(false);
    }
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    toast.success("已复制回复。");
  }

  function renderAssistantMessage(content: string) {
    const parsed = parseAssistantContent(content);
    return (
      <div className="w-full min-w-0">
        {parsed.thought && (
          <details className="mb-3 rounded-xl border border-[#5B7CFF]/20 bg-[#5B7CFF]/5 px-3 py-2">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-[#5B7CFF]">
              <Brain className="h-3.5 w-3.5" />
              详细思考说明
            </summary>
            <div className="mt-2 text-muted-foreground">
              <MarkdownContent content={parsed.thought} compact />
            </div>
          </details>
        )}
        <MarkdownContent content={parsed.answer} />
        <div className="mt-3 flex justify-end border-t border-border/60 pt-2">
          <Button variant="ghost" size="sm" onClick={() => copyText(parsed.answer)}>
            <Copy className="h-3.5 w-3.5" />
            复制
          </Button>
        </div>
      </div>
    );
  }

  return (
    <PageShell>
      {/* Fixed viewport height so only the message list scrolls, not the whole page. */}
      <div className="grid h-[calc(100dvh-7.25rem)] min-h-[520px] gap-4 lg:gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="flex shrink-0 flex-col items-start gap-3 border-b border-border px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight">GPT 文字对话</h2>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">OpenAI / Grok · Markdown · 公式 · 附件分析</p>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
              <div className="flex rounded-xl border border-border bg-background/70 p-1">
                {providers.map((item) => (
                  <button
                    key={item.value}
                    onClick={() => changeProvider(item.value)}
                    className={cn(
                      "h-8 rounded-lg px-3 text-xs font-semibold transition",
                      provider === item.value ? "bg-[#5B7CFF] text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <select
                aria-label={`${provider === "grok" ? "Grok" : "OpenAI"} 模型版本`}
                title={availableModels.find((item) => item.model_id === model)?.model_id ?? "使用通道默认模型"}
                value={model}
                disabled={modelsLoading || availableModels.length === 0}
                onChange={(event) => changeModel(event.target.value)}
                className="h-10 min-w-[150px] max-w-[220px] flex-1 rounded-xl border border-border bg-background/70 px-3 text-xs font-semibold outline-none transition focus:border-[#5B7CFF] focus:ring-2 focus:ring-[#5B7CFF]/15 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
              >
                {modelsLoading ? (
                  <option value="">正在加载模型...</option>
                ) : availableModels.length === 0 ? (
                  <option value="">通道默认模型</option>
                ) : (
                  availableModels.map((item) => (
                    <option key={item.id} value={item.model_id}>
                      {item.display_name}{item.is_default ? "（默认）" : ""}
                    </option>
                  ))
                )}
              </select>
              <Button variant="secondary" size="sm" onClick={startNewChat}>
                <Plus className="h-4 w-4" />
                新对话
              </Button>
            </div>
          </div>

          <div className="soft-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5">
            {/* Full-width message rail so bubbles track the dialog width. */}
            <div className="mx-auto flex w-full max-w-none flex-col gap-4">
              {messages.length === 0 ? (
                <div className="grid min-h-[240px] flex-1 place-items-center text-center">
                  <div className="max-w-lg">
                    <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#5B7CFF]/10 text-[#5B7CFF]">
                      <SendHorizontal className="h-6 w-6" />
                    </div>
                    <h3 className="mt-5 text-xl font-semibold">向 AI 发起第一条创作请求</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">选择通道后发送消息，回复会铺满对话区宽度，阅读更连贯。</p>
                  </div>
                </div>
              ) : (
                messages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={cn("flex w-full", message.role === "user" ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "text-sm leading-6",
                        message.role === "user"
                          ? "chat-user-bubble w-fit max-w-[min(100%,42rem)] rounded-2xl rounded-br-md bg-[#5B7CFF] px-4 py-3 text-white shadow-sm sm:px-5"
                          : "chat-assistant-bubble w-full max-w-full rounded-2xl rounded-bl-md border border-border bg-background/80 px-4 py-3.5 shadow-sm sm:px-5 sm:py-4"
                      )}
                    >
                      {message.role === "assistant" ? (
                        renderAssistantMessage(message.content)
                      ) : (
                        <div className="whitespace-pre-wrap break-words">{message.content}</div>
                      )}
                    </div>
                  </div>
                ))
              )}

              {loading && (
                <div className="flex w-full justify-start">
                  <div className="inline-flex items-center gap-3 rounded-2xl border border-border bg-background/80 px-4 py-3 text-sm text-muted-foreground shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-[#5B7CFF]" />
                    AI 正在通过 {respondingProvider === "grok" ? "Grok" : "OpenAI"}
                    {respondingModelId ? ` · ${respondingModel?.display_name ?? respondingModelId}` : ""} 组织回复...
                  </div>
                </div>
              )}
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
                value={input}
                maxLength={4000}
                className="min-h-[96px]"
                placeholder="输入你的问题或创作需求，Enter 发送，Shift + Enter 换行..."
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <input id="chat-attachments" type="file" multiple accept={FILE_ACCEPT} className="hidden" onChange={(event) => addFiles(event.target.files)} />
                  <Button asChild variant="secondary" size="icon" aria-label="上传附件">
                    <label htmlFor="chat-attachments" className="cursor-pointer">
                      <Paperclip className="h-4 w-4" />
                    </label>
                  </Button>
                  <span className="text-xs text-muted-foreground">{input.length}/4000</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={!lastUserMessage || loading} onClick={() => lastUserMessage && submit(lastUserMessage, [])}>
                    <RefreshCcw className="h-4 w-4" />
                    重新生成
                  </Button>
                  <Button disabled={loading || (!input.trim() && selectedFiles.length === 0)} onClick={() => submit()}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
                    发送
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card className="flex h-full min-h-0 flex-col overflow-hidden p-4 sm:p-5">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">最近会话</h3>
              <p className="mt-1 text-xs text-muted-foreground">最近 10 条，可继续原对话</p>
            </div>
            <Button variant="secondary" size="icon" onClick={startNewChat} aria-label="新对话">
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="soft-scrollbar mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-0.5">
            {sessionsLoading ? (
              <div className="flex items-center gap-2 rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-[#5B7CFF]" />
                正在读取...
              </div>
            ) : sessions.length === 0 ? (
              <div className="grid min-h-[200px] place-items-center rounded-2xl border border-dashed border-border bg-background/60 text-center">
                <div>
                  <MessageSquareText className="mx-auto h-6 w-6 text-[#5B7CFF]" />
                  <p className="mt-3 text-sm font-medium">还没有会话</p>
                  <p className="mt-1 text-xs text-muted-foreground">发送第一条消息后会自动保存。</p>
                </div>
              </div>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className={cn(
                    "group flex w-full items-start gap-2 rounded-2xl border border-border bg-background/70 p-3 text-left transition hover:border-[#5B7CFF]/45",
                    activeSessionId === session.id && "border-[#5B7CFF] bg-[#5B7CFF]/10"
                  )}
                >
                  <button className="min-w-0 flex-1 text-left" onClick={() => openSession(session.id)}>
                    <div className="line-clamp-2 text-sm font-semibold">{session.title}</div>
                    <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock3 className="h-3.5 w-3.5" />
                      {new Date(session.updated_at).toLocaleString()}
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground opacity-70 transition hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                    disabled={deletingSessionId === session.id}
                    onClick={() => deleteSession(session.id)}
                    aria-label="删除会话"
                    title="删除会话"
                  >
                    {deletingSessionId === session.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
