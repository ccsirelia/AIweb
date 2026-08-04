"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Download, ImageIcon, Loader2, MessageSquareText, RotateCcw, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { deleteImage, getAuthToken, getHistory, type ChatRecord, type ImageRecord } from "@/lib/api";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";

const PENDING_PROMPT_KEY = "aiweb:pending-prompt";

function displayAssistantContent(content: string) {
  const answer = content.match(/<ai_answer>\s*([\s\S]*?)\s*<\/ai_answer>/i)?.[1]?.trim();
  if (answer) return answer;
  return content.replace(/<\/?ai_[a-z_]+>/gi, "").trim();
}

export function HistoryList() {
  const [chats, setChats] = useState<ChatRecord[]>([]);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingImageId, setDeletingImageId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const router = useRouter();

  const normalizedQuery = query.trim().toLowerCase();
  const filteredChats = useMemo(
    () => chats.filter((item) => !normalizedQuery || `${item.user_message} ${item.ai_response}`.toLowerCase().includes(normalizedQuery)),
    [chats, normalizedQuery]
  );
  const filteredImages = useMemo(
    () => images.filter((item) => !normalizedQuery || `${item.prompt} ${item.style} ${item.size}`.toLowerCase().includes(normalizedQuery)),
    [images, normalizedQuery]
  );

  useEffect(() => {
    if (!getAuthToken()) {
      router.push("/login");
      return;
    }
    getHistory()
      .then((data) => {
        setChats(data.chats);
        setImages(data.images);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "历史记录加载失败。"))
      .finally(() => setLoading(false));
  }, [router]);

  function downloadImage(item: ImageRecord) {
    const link = document.createElement("a");
    link.href = `data:image/png;base64,${item.image_base64}`;
    link.download = `aiweb-image-${item.id}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function createAgain(item: ImageRecord) {
    try {
      sessionStorage.setItem(PENDING_PROMPT_KEY, JSON.stringify({ prompt: item.prompt, target: "image" }));
      router.push("/image");
    } catch {
      toast.error("无法暂存图片提示词，请检查浏览器存储权限。");
    }
  }

  async function removeImage(item: ImageRecord) {
    if (!window.confirm("确定删除这张图片吗？删除后无法恢复。")) return;

    setDeletingImageId(item.id);
    try {
      await deleteImage(item.id);
      setImages((current) => current.filter((record) => record.id !== item.id));
      toast.success("图片已删除。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片删除失败。");
    } finally {
      setDeletingImageId(null);
    }
  }

  return (
    <PageShell>
      {loading ? (
        <div className="grid min-h-[55vh] place-items-center">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 text-sm text-muted-foreground shadow-soft">
            <Loader2 className="h-4 w-4 animate-spin text-[#5B7CFF]" />
            正在读取历史记录...
          </div>
        </div>
      ) : chats.length === 0 && images.length === 0 ? (
        <Card className="grid min-h-[55vh] place-items-center p-8 text-center">
          <div>
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#5B7CFF]/10 text-[#5B7CFF]">
              <Clock className="h-6 w-6" />
            </div>
            <h2 className="mt-5 text-xl font-semibold">还没有历史记录</h2>
            <p className="mt-2 text-sm text-muted-foreground">完成一次聊天或生图后，这里会自动展示。</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/55 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-[#2DD4BF] shadow-[0_0_8px_#2DD4BF]" />
              已索引 {chats.length} 条对话与 {images.length} 张图片
            </div>
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提示词、回答或风格" className="h-10 w-full rounded-md border border-border bg-background/70 pl-9 pr-9 text-sm outline-none focus:border-[#2DD4BF]/60" />
              {query ? <button type="button" onClick={() => setQuery("")} aria-label="清空搜索" className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3.5 w-3.5" /></button> : null}
            </div>
          </div>

          {filteredChats.length === 0 && filteredImages.length === 0 ? (
            <div className="grid min-h-[320px] place-items-center rounded-lg border border-dashed border-border bg-card/35 text-center">
              <div><Search className="mx-auto h-6 w-6 text-[#2DD4BF]" /><p className="mt-3 text-sm font-medium">没有匹配的创作记录</p></div>
            </div>
          ) : <div className="grid min-w-0 gap-5 xl:grid-cols-2">
          <section className="min-w-0">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <MessageSquareText className="h-4 w-4 text-[#5B7CFF]" />
              聊天记录
            </div>
            <div className="space-y-3">
              {filteredChats.map((item) => (
                <Card key={item.id} className="min-w-0 overflow-hidden p-5">
                  <div className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</div>
                  <div className="mt-3 break-words text-sm font-medium">{item.user_message}</div>
                  <p className="mt-3 line-clamp-4 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{displayAssistantContent(item.ai_response)}</p>
                </Card>
              ))}
            </div>
          </section>

          <section className="min-w-0">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <ImageIcon className="h-4 w-4 text-[#5B7CFF]" />
              图片图库
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filteredImages.map((item) => (
                <Card key={item.id} className="overflow-hidden">
                  <img src={`data:image/png;base64,${item.image_base64}`} alt={item.prompt} className="aspect-square w-full object-cover" />
                  <div className="p-4">
                    <div className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</div>
                    <div className="mt-2 line-clamp-2 break-words text-sm font-medium">{item.prompt}</div>
                    <div className="mt-3 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>{item.style}</span>
                      <span>{item.size}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-end gap-1 border-t border-border/70 pt-3">
                      <button
                        type="button"
                        onClick={() => downloadImage(item)}
                        aria-label="下载原图"
                        title="下载原图"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => createAgain(item)}
                        aria-label="复用提示词并再次创作"
                        title="复用提示词并再次创作"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-[#5B7CFF] transition hover:bg-[#5B7CFF]/10"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeImage(item)}
                        disabled={deletingImageId !== null}
                        aria-label="删除图片"
                        title="删除图片"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-red-500/10 hover:text-red-500 disabled:pointer-events-none disabled:opacity-50"
                      >
                        {deletingImageId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </section>
          </div>}
        </div>
      )}
    </PageShell>
  );
}
