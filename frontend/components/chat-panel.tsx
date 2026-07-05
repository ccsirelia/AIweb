"use client";

import { useMemo, useState } from "react";
import { Copy, Loader2, RefreshCcw, SendHorizontal } from "lucide-react";
import { toast } from "sonner";

import { sendChat } from "@/lib/api";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export function ChatPanel() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const lastUserMessage = useMemo(() => [...messages].reverse().find((item) => item.role === "user")?.content, [messages]);

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
      const result = await sendChat(trimmed);
      setMessages((prev) => [...prev, { role: "assistant", content: result.text }]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI 回复失败。");
      setInput(trimmed);
    } finally {
      setLoading(false);
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
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-lg font-semibold">GPT 文字对话</h2>
            <p className="mt-1 text-sm text-muted-foreground">用于策略、文案、代码、创意方向和深度问答。</p>
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

        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold">创作建议</h3>
            <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
              <p>说明目标、受众、语气和输出格式，会得到更稳定的结果。</p>
              <p>长任务可以拆成“先给提纲，再逐段扩写”。</p>
            </div>
          </Card>
          <Card className="p-5">
            <h3 className="text-sm font-semibold">历史保存</h3>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">每次成功回复都会写入后端 SQLite，可在历史记录页查看。</p>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
