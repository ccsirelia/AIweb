"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Download, ImageIcon, Loader2, MessageSquareText, RotateCcw, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { deleteImage, getAuthToken, getHistory, getImageContent, type ChatRecord, type HistoryPage, type ImageRecord } from "@/lib/api";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";

const PENDING_PROMPT_KEY = "aiweb:pending-prompt";

function displayAssistantContent(content: string) {
  const answer = content.match(/<ai_answer>\s*([\s\S]*?)\s*<\/ai_answer>/i)?.[1]?.trim();
  if (answer) return answer;
  return content.replace(/<\/?ai_[a-z_]+>/gi, "").trim();
}

function HistoryImageCard({
  item,
  deleting,
  onDownload,
  onCreateAgain,
  onRemove
}: {
  item: ImageRecord;
  deleting: boolean;
  onDownload: (item: ImageRecord) => void;
  onCreateAgain: (item: ImageRecord) => void;
  onRemove: (item: ImageRecord) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState("");

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    let observer: IntersectionObserver | null = null;
    let started = false;

    const loadThumbnail = () => {
      if (started) return;
      started = true;
      getImageContent(item.id, "thumb")
        .then((blob) => {
          if (!active) return;
          objectUrl = URL.createObjectURL(blob);
          setThumbnailUrl(objectUrl);
        })
        .catch(() => undefined);
    };

    if (typeof IntersectionObserver === "undefined" || !containerRef.current) {
      loadThumbnail();
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            loadThumbnail();
            observer?.disconnect();
          }
        },
        { rootMargin: "240px" }
      );
      observer.observe(containerRef.current);
    }

    return () => {
      active = false;
      observer?.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.id]);

  return (
    <div ref={containerRef}>
      <Card className="overflow-hidden">
      <div className="aspect-square bg-muted">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={item.prompt} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">缩略图加载中</div>
        )}
      </div>
      <div className="p-4">
        <div className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</div>
        <div className="mt-2 line-clamp-2 break-words text-sm font-medium">{item.prompt}</div>
        <div className="mt-3 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{item.style}</span>
          <span>{item.size}</span>
        </div>
        <div className="mt-3 flex items-center justify-end gap-1 border-t border-border/70 pt-3">
          <button type="button" onClick={() => onDownload(item)} aria-label="下载原图" title="下载原图" className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <Download className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onCreateAgain(item)} aria-label="复用提示词并再次创作" title="复用提示词并再次创作" className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-[#5B7CFF] transition hover:bg-[#5B7CFF]/10">
            <RotateCcw className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onRemove(item)} disabled={deleting} aria-label="删除图片" title="删除图片" className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-red-500/10 hover:text-red-500 disabled:pointer-events-none disabled:opacity-50">
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        </div>
      </div>
      </Card>
    </div>
  );
}

export function HistoryList() {
  const [chats, setChats] = useState<ChatRecord[]>([]);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState<"chat" | "image" | null>(null);
  const [deletingImageId, setDeletingImageId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [chatPage, setChatPage] = useState(1);
  const [imagePage, setImagePage] = useState(1);
  const [chatHasMore, setChatHasMore] = useState(false);
  const [imageHasMore, setImageHasMore] = useState(false);
  const router = useRouter();
  const requestCacheRef = useRef(new Map<string, Promise<HistoryPage>>());

  const normalizedQuery = query.trim().toLowerCase();
  const filteredChats = useMemo(
    () => chats.filter((item) => !normalizedQuery || `${item.user_message} ${item.ai_response}`.toLowerCase().includes(normalizedQuery)),
    [chats, normalizedQuery]
  );
  const filteredImages = useMemo(
    () => images.filter((item) => !normalizedQuery || `${item.prompt} ${item.style} ${item.size}`.toLowerCase().includes(normalizedQuery)),
    [images, normalizedQuery]
  );

  function requestHistory(nextChatPage: number, nextImagePage: number) {
    const key = `${nextChatPage}:${nextImagePage}`;
    const existing = requestCacheRef.current.get(key);
    if (existing) return existing;
    const request = getHistory({ chatPage: nextChatPage, imagePage: nextImagePage, pageSize: 12 }).finally(() => requestCacheRef.current.delete(key));
    requestCacheRef.current.set(key, request);
    return request;
  }

  useEffect(() => {
    if (!getAuthToken()) {
      router.push("/login");
      return;
    }
    let active = true;
    requestHistory(1, 1)
      .then((data) => {
        if (!active) return;
        setChats(data.chats);
        setImages(data.images);
        setChatPage(data.chat_page);
        setImagePage(data.image_page);
        setChatHasMore(data.chat_has_more);
        setImageHasMore(data.image_has_more);
      })
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : "历史记录加载失败。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [router]);

  async function loadMore(kind: "chat" | "image") {
    const nextChatPage = kind === "chat" ? chatPage + 1 : chatPage;
    const nextImagePage = kind === "image" ? imagePage + 1 : imagePage;
    setLoadingMore(kind);
    try {
      const data = await requestHistory(nextChatPage, nextImagePage);
      if (kind === "chat") {
        setChats((current) => [...current, ...data.chats]);
        setChatPage(data.chat_page);
        setChatHasMore(data.chat_has_more);
      } else {
        setImages((current) => [...current, ...data.images]);
        setImagePage(data.image_page);
        setImageHasMore(data.image_has_more);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更多记录加载失败。");
    } finally {
      setLoadingMore(null);
    }
  }

  async function downloadImage(item: ImageRecord) {
    try {
      const blob = await getImageContent(item.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `aiweb-image-${item.id}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "原图下载失败。");
    }
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
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#5B7CFF]/10 text-[#5B7CFF]"><Clock className="h-6 w-6" /></div>
            <h2 className="mt-5 text-xl font-semibold">还没有历史记录</h2>
            <p className="mt-2 text-sm text-muted-foreground">完成一次聊天或生图后，这里会自动展示。</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/55 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-[#2DD4BF] shadow-[0_0_8px_#2DD4BF]" />
              已加载 {chats.length} 条对话与 {images.length} 张图片
            </div>
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索已加载的提示词、回答或风格" className="h-10 w-full rounded-md border border-border bg-background/70 pl-9 pr-9 text-sm outline-none focus:border-[#2DD4BF]/60" />
              {query ? <button type="button" onClick={() => setQuery("")} aria-label="清空搜索" className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3.5 w-3.5" /></button> : null}
            </div>
          </div>

          {filteredChats.length === 0 && filteredImages.length === 0 ? (
            <div className="grid min-h-[320px] place-items-center rounded-lg border border-dashed border-border bg-card/35 text-center">
              <div><Search className="mx-auto h-6 w-6 text-[#2DD4BF]" /><p className="mt-3 text-sm font-medium">没有匹配的创作记录</p></div>
            </div>
          ) : <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <section className="min-w-0">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><MessageSquareText className="h-4 w-4 text-[#5B7CFF]" />聊天记录</div>
              <div className="space-y-3">
                {filteredChats.map((item) => (
                  <Card key={item.id} className="min-w-0 overflow-hidden p-5">
                    <div className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</div>
                    <div className="mt-3 break-words text-sm font-medium">{item.user_message}</div>
                    <p className="mt-3 line-clamp-4 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{displayAssistantContent(item.ai_response)}</p>
                  </Card>
                ))}
              </div>
              {chatHasMore ? <button type="button" onClick={() => loadMore("chat")} disabled={loadingMore !== null} className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border text-sm text-muted-foreground transition hover:border-[#5B7CFF]/50 hover:text-foreground disabled:opacity-50">{loadingMore === "chat" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}加载更多对话</button> : null}
            </section>

            <section className="min-w-0">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><ImageIcon className="h-4 w-4 text-[#5B7CFF]" />图片图库</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {filteredImages.map((item) => <HistoryImageCard key={item.id} item={item} deleting={deletingImageId === item.id} onDownload={downloadImage} onCreateAgain={createAgain} onRemove={removeImage} />)}
              </div>
              {imageHasMore ? <button type="button" onClick={() => loadMore("image")} disabled={loadingMore !== null} className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border text-sm text-muted-foreground transition hover:border-[#5B7CFF]/50 hover:text-foreground disabled:opacity-50">{loadingMore === "image" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}加载更多图片</button> : null}
            </section>
          </div>}
        </div>
      )}
    </PageShell>
  );
}
