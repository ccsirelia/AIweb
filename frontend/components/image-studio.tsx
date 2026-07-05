"use client";

import { useState } from "react";
import { Download, ImageIcon, Loader2, RefreshCcw, WandSparkles } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { generateImage } from "@/lib/api";
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
  const [gallery, setGallery] = useState<string[]>([]);

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
      setGallery((prev) => [result.image_base64, ...prev].slice(0, 8));
      toast.success("图片生成完成。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片生成失败。");
    } finally {
      setLoading(false);
    }
  }

  function downloadImage() {
    if (!image) return;
    const link = document.createElement("a");
    link.href = `data:image/png;base64,${image}`;
    link.download = `aiweb-image-${Date.now()}.png`;
    link.click();
  }

  return (
    <PageShell>
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
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

        <div className="space-y-5">
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
              <Button disabled={!image} onClick={downloadImage}>
                <Download className="h-4 w-4" />
                下载
              </Button>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {gallery.map((item, index) => (
              <button
                key={`${item.slice(0, 12)}-${index}`}
                className="overflow-hidden rounded-2xl border border-border bg-card transition hover:-translate-y-0.5"
                onClick={() => setImage(item)}
              >
                <img src={`data:image/png;base64,${item}`} alt="Gallery item" className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
