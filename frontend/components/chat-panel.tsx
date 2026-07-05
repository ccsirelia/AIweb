"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3, Copy, Loader2, MessageSquareText, Plus, RefreshCcw, SendHorizontal } from "lucide-react";
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

const ACTIVE_SESSION_KEY = "aiweb_active_chat_session_id";
const PENDING_JOBS_KEY = "aiweb_pending_chat_jobs";

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

export function ChatPanel() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [pendingJobs, setPendingJobs] = useState<ChatJob[]>([]);
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
      } catch (error) {
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
    setLoading(false);
  }

  async function submit(message = input) {
    const trimmed = message.trim();
    if (!trimmed) return;
    if (trimmed.length > 4000) {
      toast.error("输入不能超过 4000 个字符。");
      return;
    }

    setLoading(true);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    try {
      const job = await createChatJob(trimmed, activeSessionId);
      setActiveSessionId(job.session_id);
      localStorage.setItem(ACTIVE_SESSION_KEY, String(job.session_id));
      const jobs = [...readPendingJobs().filter((item) => item.id !== job.id), job];
      writePendingJobs(jobs);
      setPendingJobs(jobs);
      await refreshSessions();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI 回复失败。");
      setInput(trimmed);
      setLoading(false);
    } finally {
      // Completion is handled by the background-job poller.
    }
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    toast.success("已复制回复。");
  }

  return (
    <PageShell>
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Card className="flex min-h-[72vh] flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold">GPT 文字对话</h2>
              <p className="mt-1 text-sm text-muted-foreground">用于策略、文案、代码、创意方向和深度问答。</p>
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
                  <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                    例如：帮我为一家高端咖啡品牌生成一套小红书内容策划。
                  </p>
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
                    <div className="whitespace-pre-wrap">{message.content}</div>
                    {message.role === "assistant" && (
                      <div className="mt-3 flex justify-end">
                        <Button variant="ghost" size="sm" onClick={() => copyText(message.content)}>
                          <Copy className="h-3.5 w-3.5" />
                          复制
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-[#5B7CFF]" />
                  AI 正在组织回复...
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-border p-4">
            <div className="flex flex-col gap-3">
              <Textarea
                value={input}
                maxLength={4000}
                placeholder="输入你的问题或创作需求..."
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
                }}
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">{input.length}/4000</span>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={!lastUserMessage || loading} onClick={() => lastUserMessage && submit(lastUserMessage)}>
                    <RefreshCcw className="h-4 w-4" />
                    重新生成
                  </Button>
                  <Button disabled={loading || !input.trim()} onClick={() => submit()}>
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
