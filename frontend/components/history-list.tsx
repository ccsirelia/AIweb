"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, ImageIcon, Loader2, MessageSquareText } from "lucide-react";
import { toast } from "sonner";

import { getAuthToken, getHistory, type ChatRecord, type ImageRecord } from "@/lib/api";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";

export function HistoryList() {
  const [chats, setChats] = useState<ChatRecord[]>([]);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

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
        <div className="grid gap-5 xl:grid-cols-2">
          <section>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <MessageSquareText className="h-4 w-4 text-[#5B7CFF]" />
              聊天记录
            </div>
            <div className="space-y-3">
              {chats.map((item) => (
                <Card key={item.id} className="p-5">
                  <div className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</div>
                  <div className="mt-3 text-sm font-medium">{item.user_message}</div>
                  <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{item.ai_response}</p>
                </Card>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <ImageIcon className="h-4 w-4 text-[#5B7CFF]" />
              图片图库
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {images.map((item) => (
                <Card key={item.id} className="overflow-hidden">
                  <img src={`data:image/png;base64,${item.image_base64}`} alt={item.prompt} className="aspect-square w-full object-cover" />
                  <div className="p-4">
                    <div className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</div>
                    <div className="mt-2 line-clamp-2 text-sm font-medium">{item.prompt}</div>
                    <div className="mt-3 flex gap-2 text-xs text-muted-foreground">
                      <span>{item.style}</span>
                      <span>{item.size}</span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        </div>
      )}
    </PageShell>
  );
}
