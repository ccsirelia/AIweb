"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Brain, Clock3, Copy, FileText, Loader2, MessageSquareText, Paperclip, Plus, RefreshCcw, SendHorizontal, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { toast } from "sonner";

import { createChatJob, getAuthToken, getChatJob, getChatSession, getChatSessions, type ChatJob, type ChatSession } from "@/lib/api";
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
const FILE_ACCEPT = "image/*,.txt,.md,.csv,.json,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.py,.js,.jsx,.ts,.tsx,.html,.css,.xml,.yaml,.yml";

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
  const [pendingJobs, setPendingJobs] = useState<ChatJob[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const router = useRouter();
  const lastUserMessage = useMemo(() => [...messages].reverse().find((item) => item.role === "user")?.content, [messages]);

  useEffect(() => {
    if (!getAuthToken()) {
      router.push("/login");
      return;
    }
    const storedSessionId = Number(localStorage.getItem(ACTIVE_SESSION_KEY) || "");
    const storedJobs = readPendingJobs();
    setPendingJobs(storedJobs);
    refreshSessions();
    if (storedSessionId) {
      openSession(storedSessionId);
    }
  }, [router]);

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

  function startNewChat() {
    setActiveSessionId(null);
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    setMessages([]);
    setInput("");
    setSelectedFiles([]);
    setLoading(false);
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
      const job = await createChatJob(fallbackMessage, activeSessionId, files);
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
      <>
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
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => copyText(parsed.answer)}>
            <Copy className="h-3.5 w-3.5" />
            复制
          </Button>
        </div>
      </>
    );
  }

  return (
    <PageShell>
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Card className="flex min-h-[72vh] flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold">GPT 文字对话</h2>
              <p className="mt-1 text-sm text-muted-foreground">支持 Markdown、数学公式、代码块和附件分析。</p>
            </div>
            <Button variant="secondary" size="sm" onClick={startNewChat}>
              <Plus className="h-4 w-4" />
              新对话
            </Button>
          </div>

          <div className="soft-scrollbar flex-1 space-y-4 overflow-y-auto p-5">
            {messages.length === 0 ? (
              <div className="grid h-full min-h-[360px] place-items-center text-center">
                <div>
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#5B7CFF]/10 text-[#5B7CFF]">
                    <SendHorizontal className="h-6 w-6" />
                  </div>
                  <h3 className="mt-5 text-xl font-semibold">向 AI 发起第一条创作请求</h3>
                  <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">可以上传图片、文本或常见办公文档，也可以直接输入含公式的问题。</p>
                </div>
              </div>
            ) : (
              messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={
                      message.role === "user"
                        ? "max-w-[86%] rounded-2xl bg-[#5B7CFF] px-4 py-3 text-sm leading-6 text-white"
                        : "max-w-[86%] rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm leading-6"
                    }
                  >
                    {message.role === "assistant" ? renderAssistantMessage(message.content) : <div className="whitespace-pre-wrap">{message.content}</div>}
                  </div>
                </div>
              ))
            )}

            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-[#5B7CFF]" />
                  AI 正在思考并组织回复...
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-border p-4">
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

        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">最近会话</h3>
              <p className="mt-1 text-xs text-muted-foreground">保留最近 10 条，可继续原对话。</p>
            </div>
            <Button variant="secondary" size="icon" onClick={startNewChat} aria-label="新对话">
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="mt-4 space-y-2">
            {sessionsLoading ? (
              <div className="flex items-center gap-2 rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-[#5B7CFF]" />
                正在读取...
              </div>
            ) : sessions.length === 0 ? (
              <div className="grid min-h-[220px] place-items-center rounded-2xl border border-dashed border-border bg-background/60 text-center">
                <div>
                  <MessageSquareText className="mx-auto h-6 w-6 text-[#5B7CFF]" />
                  <p className="mt-3 text-sm font-medium">还没有会话</p>
                  <p className="mt-1 text-xs text-muted-foreground">发送第一条消息后会自动保存。</p>
                </div>
              </div>
            ) : (
              sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => openSession(session.id)}
                  className={cn(
                    "w-full rounded-2xl border border-border bg-background/70 p-3 text-left transition hover:-translate-y-0.5 hover:border-[#5B7CFF]/50",
                    activeSessionId === session.id && "border-[#5B7CFF] bg-[#5B7CFF]/10"
                  )}
                >
                  <div className="line-clamp-2 text-sm font-semibold">{session.title}</div>
                  <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock3 className="h-3.5 w-3.5" />
                    {new Date(session.updated_at).toLocaleString()}
                  </div>
                </button>
              ))
            )}
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
