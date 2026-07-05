"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ImageIcon, Loader2, RefreshCcw, WandSparkles } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { generateImage, getAuthToken, getRecentImages, type ImageRecord } from "@/lib/api";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

const styles = ["写实", "动漫", "3D", "油画", "产品图", "摄影"];
const sizes = [
  { label: "1:1", value: "1024x1024" },
  { label: "16:9", value: "1536x864" },
  { label: "9:16", value: "864x1536" }
];

export function ImageStudio() {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("写实");
  const [size, setSize] = useState("1024x1024");
  const [image, setImage] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [recentImages, setRecentImages] = useState<ImageRecord[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (!getAuthToken()) {
      router.push("/login");
      return;
    }
    refreshImages();
  }, [router]);

  async function refreshImages() {
    setHistoryLoading(true);
    try {
      const records = await getRecentImages();
      setRecentImages(records);
      if (!image && records[0]) {
        setImage(records[0].image_base64);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片历史加载失败。");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function createImage(nextPrompt = prompt) {
    const trimmed = nextPrompt.trim();
    if (!trimmed) return;
    if (trimmed.length > 1200) {
      toast.error("Prompt 不能超过 1200 个字符。");
      return;
    }

    setLoading(true);
    try {
      const result = await generateImage({ prompt: trimmed, style, size });
      setImage(result.image_base64);
      await refreshImages();
      toast.success("图片生成完成。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片生成失败。");
    } finally {
      setLoading(false);
    }
  }

  function downloadBase64(imageBase64: string, name = `aiweb-image-${Date.now()}.png`) {
    const link = document.createElement("a");
    link.href = `data:image/png;base64,${imageBase64}`;
    link.download = name;
    link.click();
  }

  function openHistoryImage(record: ImageRecord) {
    setImage(record.image_base64);
    setPrompt(record.prompt);
    setStyle(record.style);
    setSize(record.size);
  }

  return (
    <PageShell>
      <div className="grid gap-5 2xl:grid-cols-[420px_1fr_340px] xl:grid-cols-[380px_1fr]">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#5B7CFF]/10 text-[#5B7CFF]">
              <WandSparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">AI Image Studio</h2>
              <p className="text-sm text-muted-foreground">生成商业级视觉草图。</p>
            </div>
          </div>

          <div className="mt-6 space-y-5">
            <div>
              <label className="text-sm font-medium">Prompt</label>
              <Textarea
                value={prompt}
                maxLength={1200}
                className="mt-2 min-h-[180px]"
                placeholder="一只穿宇航服的橘猫，赛博朋克风格，电影感灯光..."
                onChange={(event) => setPrompt(event.target.value)}
              />
              <div className="mt-2 text-right text-xs text-muted-foreground">{prompt.length}/1200</div>
            </div>

            <div>
              <label className="text-sm font-medium">风格</label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {styles.map((item) => (
                  <button
                    key={item}
                    onClick={() => setStyle(item)}
                    className={`h-10 rounded-xl border text-sm transition hover:scale-[1.02] ${
                      style === item ? "border-[#5B7CFF] bg-[#5B7CFF] text-white" : "border-border bg-background/70"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">尺寸</label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {sizes.map((item) => (
                  <button
                    key={item.value}
                    onClick={() => setSize(item.value)}
                    className={`h-10 rounded-xl border text-sm transition hover:scale-[1.02] ${
                      size === item.value ? "border-[#5B7CFF] bg-[#5B7CFF] text-white" : "border-border bg-background/70"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <Button className="w-full" disabled={loading || !prompt.trim()} onClick={() => createImage()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
              生成图片
            </Button>
          </div>
        </Card>

        <Card className="overflow-hidden p-4">
          <div className="relative grid min-h-[520px] place-items-center overflow-hidden rounded-2xl border border-border bg-background/70">
            {loading ? (
              <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-slate-200 via-white to-blue-100 dark:from-white/[0.06] dark:via-white/[0.1] dark:to-blue-500/10" />
            ) : image ? (
              <motion.img
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.35 }}
                src={`data:image/png;base64,${image}`}
                alt="AI generated"
                className="h-full max-h-[720px] w-full object-contain"
              />
            ) : (
              <div className="text-center">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#5B7CFF]/10 text-[#5B7CFF]">
                  <ImageIcon className="h-6 w-6" />
                </div>
                <h3 className="mt-5 text-xl font-semibold">等待生成第一张作品</h3>
                <p className="mt-2 text-sm text-muted-foreground">选择风格和比例，然后让 Prompt 变成画面。</p>
              </div>
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" disabled={!prompt.trim() || loading} onClick={() => createImage(prompt)}>
              <RefreshCcw className="h-4 w-4" />
              重新生成
            </Button>
            <Button disabled={!image} onClick={() => image && downloadBase64(image)}>
              <Download className="h-4 w-4" />
              下载原图
            </Button>
          </div>
        </Card>

        <Card className="p-5 xl:col-span-2 2xl:col-span-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">最近生成</h3>
              <p className="mt-1 text-xs text-muted-foreground">持久保存最近 10 张图，支持原图下载。</p>
            </div>
            <Button variant="secondary" size="icon" onClick={refreshImages} aria-label="刷新图片历史">
              {historyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 2xl:grid-cols-1">
            {historyLoading && recentImages.length === 0 ? (
              <div className="col-span-full flex items-center gap-2 rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-[#5B7CFF]" />
                正在读取图片...
              </div>
            ) : recentImages.length === 0 ? (
              <div className="col-span-full grid min-h-[220px] place-items-center rounded-2xl border border-dashed border-border bg-background/60 text-center">
                <div>
                  <ImageIcon className="mx-auto h-6 w-6 text-[#5B7CFF]" />
                  <p className="mt-3 text-sm font-medium">暂无图片历史</p>
                  <p className="mt-1 text-xs text-muted-foreground">生成成功后会自动出现在这里。</p>
                </div>
              </div>
            ) : (
              recentImages.map((record) => (
                <div key={record.id} className="overflow-hidden rounded-2xl border border-border bg-background/70 transition hover:-translate-y-0.5">
                  <button className="block w-full" onClick={() => openHistoryImage(record)}>
                    <img src={`data:image/png;base64,${record.image_base64}`} alt={record.prompt} className="aspect-square w-full object-cover" />
                  </button>
                  <div className="p-3">
                    <p className="line-clamp-2 text-xs font-medium">{record.prompt}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">{record.style}</span>
                      <button
                        className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border bg-card text-[#5B7CFF] transition hover:scale-[1.04]"
                        onClick={() => downloadBase64(record.image_base64, `aiweb-image-${record.id}.png`)}
                        aria-label="下载原图"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
