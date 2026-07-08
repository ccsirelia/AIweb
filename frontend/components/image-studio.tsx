"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ImageIcon, Loader2, RefreshCcw, WandSparkles } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { generateImage, getAuthToken, getRecentImages, type ImageRecord, type Provider } from "@/lib/api";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const styles = ["写实", "动漫", "3D", "油画", "产品图", "摄影"];
const aspectRatios = ["16:9", "1:1", "9:16"] as const;
const openaiQualities = ["1k", "2k", "4k"] as const;
const gorkQualities = ["1k", "2k"] as const;
const providers: { label: string; value: Provider }[] = [
  { label: "OpenAI", value: "openai" },
  { label: "Gork", value: "gork" }
];
const presetSizes = {
  "16:9": { "1k": "1920x1024", "2k": "2560x1440", "4k": "3840x2160" },
  "1:1": { "1k": "1024x1024", "2k": "2560x2560", "4k": "3840x3840" },
  "9:16": { "1k": "1024x1920", "2k": "1440x2560", "4k": "2160x3840" }
} as const;

type AspectRatio = keyof typeof presetSizes;
type Quality = keyof (typeof presetSizes)["1:1"];

const IMAGE_PROVIDER_KEY = "aiweb_image_provider";

function validateImage2Size(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return "宽高必须是整数。";
  if (width < 512 || height < 512) return "宽高不能小于 512。";
  if (width > 3840 || height > 3840) return "宽高不能超过 3840。";
  if (width % 16 !== 0 || height % 16 !== 0) return "image2 要求宽高都能被 16 整除。";
  const ratio = width / height;
  if (ratio < 1 / 3 || ratio > 3) return "比例必须在 1:3 到 3:1 之间。";
  if (width * height > 3840 * 3840) return "像素总量不能超过 3840x3840。";
  return "";
}

export function ImageStudio() {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("写实");
  const [provider, setProvider] = useState<Provider>("openai");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [quality, setQuality] = useState<Quality>("1k");
  const [customSizeEnabled, setCustomSizeEnabled] = useState(false);
  const [customWidth, setCustomWidth] = useState(1024);
  const [customHeight, setCustomHeight] = useState(1024);
  const [image, setImage] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [recentImages, setRecentImages] = useState<ImageRecord[]>([]);
  const router = useRouter();
  const isGork = provider === "gork";
  const visibleQualities = isGork ? gorkQualities : openaiQualities;

  const size = useMemo(() => {
    if (isGork) return `${aspectRatio} ${quality === "4k" ? "2k" : quality}`;
    if (customSizeEnabled) return `${customWidth}x${customHeight}`;
    return presetSizes[aspectRatio][quality];
  }, [aspectRatio, customHeight, customSizeEnabled, customWidth, isGork, quality]);

  const customSizeError = !isGork && customSizeEnabled ? validateImage2Size(customWidth, customHeight) : "";

  useEffect(() => {
    if (!getAuthToken()) {
      router.push("/login");
      return;
    }
    const storedProvider = localStorage.getItem(IMAGE_PROVIDER_KEY);
    if (storedProvider === "openai" || storedProvider === "gork") {
      setProvider(storedProvider);
      if (storedProvider === "gork") {
        setQuality((value) => (value === "4k" ? "2k" : value));
        setCustomSizeEnabled(false);
      }
    }
    refreshImages();
  }, [router]);

  function changeProvider(value: Provider) {
    setProvider(value);
    localStorage.setItem(IMAGE_PROVIDER_KEY, value);
    if (value === "gork") {
      setQuality((current) => (current === "4k" ? "2k" : current));
      setCustomSizeEnabled(false);
    }
  }

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
    if (customSizeError) {
      toast.error(customSizeError);
      return;
    }

    const nextQuality = isGork && quality === "4k" ? "2k" : quality;
    setLoading(true);
    try {
      const result = await generateImage({
        prompt: trimmed,
        style,
        size: isGork ? presetSizes[aspectRatio][nextQuality] : size,
        aspect_ratio: isGork ? aspectRatio : customSizeEnabled ? "custom" : aspectRatio,
        quality: isGork ? nextQuality : customSizeEnabled ? "custom" : quality,
        provider
      });
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
    setStyle(styles.includes(record.style) ? record.style : "写实");
    const gorkMatch = record.size.match(/^(16:9|1:1|9:16)\s+(1k|2k)$/);
    if (gorkMatch) {
      setProvider("gork");
      setAspectRatio(gorkMatch[1] as AspectRatio);
      setQuality(gorkMatch[2] as Quality);
      setCustomSizeEnabled(false);
      return;
    }

    const [width, height] = record.size.split("x").map(Number);
    const preset = aspectRatios.flatMap((ratio) => openaiQualities.map((item) => ({ ratio, quality: item, size: presetSizes[ratio][item] }))).find((item) => item.size === record.size);
    if (preset) {
      setCustomSizeEnabled(false);
      setAspectRatio(preset.ratio);
      setQuality(preset.quality);
    } else if (width && height) {
      setCustomSizeEnabled(true);
      setCustomWidth(width);
      setCustomHeight(height);
    }
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
              <p className="text-sm text-muted-foreground">选择通道生成商业级视觉草图。</p>
            </div>
          </div>

          <div className="mt-5">
            <label className="text-sm font-medium">模型通道</label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {providers.map((item) => (
                <button
                  key={item.value}
                  onClick={() => changeProvider(item.value)}
                  className={cn(
                    "h-10 rounded-xl border text-sm font-semibold transition hover:scale-[1.02]",
                    provider === item.value ? "border-[#5B7CFF] bg-[#5B7CFF] text-white" : "border-border bg-background/70"
                  )}
                >
                  {item.label}
                </button>
              ))}
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
                    className={cn(
                      "h-10 rounded-xl border text-sm transition hover:scale-[1.02]",
                      style === item ? "border-[#5B7CFF] bg-[#5B7CFF] text-white" : "border-border bg-background/70"
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium">比例</label>
                {!isGork && (
                  <button className="text-xs text-[#5B7CFF] transition hover:text-[#466BFF]" onClick={() => setCustomSizeEnabled((value) => !value)}>
                    {customSizeEnabled ? "使用预设" : "自定义分辨率"}
                  </button>
                )}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {aspectRatios.map((item) => (
                  <button
                    key={item}
                    onClick={() => setAspectRatio(item)}
                    className={cn(
                      "h-10 rounded-xl border text-sm transition hover:scale-[1.02]",
                      aspectRatio === item ? "border-[#5B7CFF] bg-[#5B7CFF] text-white" : "border-border bg-background/70"
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>

              {!isGork && customSizeEnabled ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <input
                    value={customWidth}
                    min={512}
                    max={3840}
                    step={16}
                    type="number"
                    className="h-10 rounded-xl border border-border bg-background/70 px-3 text-sm outline-none focus:border-[#5B7CFF]"
                    onChange={(event) => setCustomWidth(Number(event.target.value))}
                    aria-label="自定义宽度"
                  />
                  <input
                    value={customHeight}
                    min={512}
                    max={3840}
                    step={16}
                    type="number"
                    className="h-10 rounded-xl border border-border bg-background/70 px-3 text-sm outline-none focus:border-[#5B7CFF]"
                    onChange={(event) => setCustomHeight(Number(event.target.value))}
                    aria-label="自定义高度"
                  />
                </div>
              ) : (
                <div className={cn("mt-3 grid gap-2", isGork ? "grid-cols-2" : "grid-cols-3")}>
                  {visibleQualities.map((item) => (
                    <button
                      key={item}
                      onClick={() => setQuality(item)}
                      className={cn(
                        "h-10 rounded-xl border text-sm uppercase transition hover:scale-[1.02]",
                        quality === item ? "border-[#5B7CFF] bg-[#5B7CFF] text-white" : "border-border bg-background/70"
                      )}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              )}

              <div className={cn("mt-2 rounded-xl border px-3 py-2 text-xs", customSizeError ? "border-red-500/40 bg-red-500/10 text-red-600" : "border-border bg-background/70 text-muted-foreground")}>
                {isGork ? `Gork 输出：${aspectRatio} · ${quality === "4k" ? "2k" : quality}` : `当前尺寸：${size}`}
                {customSizeError ? ` · ${customSizeError}` : ""}
              </div>
            </div>

            <Button className="w-full" disabled={loading || !prompt.trim() || Boolean(customSizeError)} onClick={() => createImage()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
              通过 {isGork ? "Gork" : "OpenAI"} 生成图片
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
                <p className="mt-2 text-sm text-muted-foreground">
                  {isGork ? "Gork 模式仅支持比例和 1k/2k。" : "OpenAI 模式支持预设分辨率和自定义分辨率。"}
                </p>
              </div>
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" disabled={!prompt.trim() || loading || Boolean(customSizeError)} onClick={() => createImage(prompt)}>
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
                      <span className="text-xs text-muted-foreground">
                        {record.style} · {record.size}
                      </span>
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
