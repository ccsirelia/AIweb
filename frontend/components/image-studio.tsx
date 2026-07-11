"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ImageIcon, Loader2, RefreshCcw, WandSparkles } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import {
  createImageJob,
  getAuthToken,
  getImageJob,
  getRecentImages,
  type ImageJob,
  type ImageRecord,
  type Provider
} from "@/lib/api";
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
const PENDING_IMAGE_JOBS_KEY = "aiweb_pending_image_jobs";

function readPendingImageJobs(): ImageJob[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(PENDING_IMAGE_JOBS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ImageJob[];
  } catch {
    return [];
  }
}

function writePendingImageJobs(jobs: ImageJob[]) {
  localStorage.setItem(PENDING_IMAGE_JOBS_KEY, JSON.stringify(jobs));
}

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

function downloadBase64(imageBase64: string, name = `aiweb-image-${Date.now()}.png`) {
  const link = document.createElement("a");
  link.href = `data:image/png;base64,${imageBase64}`;
  link.download = name;
  link.click();
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
  const [pendingJobs, setPendingJobs] = useState<ImageJob[]>([]);
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
    const storedJobs = readPendingImageJobs();
    setPendingJobs(storedJobs);
    setLoading(storedJobs.length > 0);
    refreshImages();
  }, [router]);

  useEffect(() => {
    if (pendingJobs.length === 0) return;
    const timer = window.setInterval(() => {
      pollPendingJobs();
    }, 1800);
    pollPendingJobs();
    return () => window.clearInterval(timer);
  }, [pendingJobs.length]);

  async function pollPendingJobs() {
    const jobs = readPendingImageJobs();
    if (jobs.length === 0) {
      setPendingJobs([]);
      setLoading(false);
      return;
    }

    const nextJobs: ImageJob[] = [];
    let completedImage = "";
    let shouldRefresh = false;
    for (const job of jobs) {
      try {
        const latest = await getImageJob(job.id);
        if (latest.status === "completed") {
          shouldRefresh = true;
          if (latest.image_base64) completedImage = latest.image_base64;
        } else if (latest.status === "failed") {
          toast.error(latest.error || "图片生成失败。");
        } else {
          nextJobs.push(latest);
        }
      } catch {
        nextJobs.push(job);
      }
    }
    writePendingImageJobs(nextJobs);
    setPendingJobs(nextJobs);
    setLoading(nextJobs.length > 0);
    if (completedImage) setImage(completedImage);
    if (shouldRefresh) {
      await refreshImages();
      if (completedImage) toast.success("图片生成完成。");
    }
  }

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
      if (!image && records[0] && readPendingImageJobs().length === 0) {
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
      const job = await createImageJob({
        prompt: trimmed,
        style,
        size: isGork ? presetSizes[aspectRatio][nextQuality] : size,
        aspect_ratio: isGork ? aspectRatio : customSizeEnabled ? "custom" : aspectRatio,
        quality: isGork ? nextQuality : customSizeEnabled ? "custom" : quality,
        provider
      });
      const jobs = [...readPendingImageJobs().filter((item) => item.id !== job.id), job];
      writePendingImageJobs(jobs);
      setPendingJobs(jobs);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片生成失败。");
      setLoading(readPendingImageJobs().length > 0);
    }
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
    const preset = aspectRatios
      .flatMap((ratio) => openaiQualities.map((item) => ({ ratio, quality: item, size: presetSizes[ratio][item] })))
      .find((item) => item.size === record.size);
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
              <p className="text-sm text-muted-foreground">选择通道生成商业级视觉草图（异步任务队列）。</p>
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
              <label className="text-sm font-medium">画幅</label>
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
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium">清晰度</label>
                {!isGork && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={customSizeEnabled} onChange={(event) => setCustomSizeEnabled(event.target.checked)} />
                    自定义分辨率
                  </label>
                )}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {visibleQualities.map((item) => (
                  <button
                    key={item}
                    onClick={() => setQuality(item)}
                    className={cn(
                      "h-10 rounded-xl border text-sm transition hover:scale-[1.02]",
                      quality === item ? "border-[#5B7CFF] bg-[#5B7CFF] text-white" : "border-border bg-background/70"
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {isGork ? "Gork 生图仅支持 1k / 2k，并使用所选画幅。" : `当前分辨率：${size}`}
              </p>
            </div>

            {!isGork && customSizeEnabled && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">宽度</label>
                  <input
                    type="number"
                    min={512}
                    max={3840}
                    step={16}
                    value={customWidth}
                    onChange={(event) => setCustomWidth(Number(event.target.value))}
                    className="mt-1 h-10 w-full rounded-xl border border-border bg-background/70 px-3 text-sm outline-none focus:border-[#5B7CFF]"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">高度</label>
                  <input
                    type="number"
                    min={512}
                    max={3840}
                    step={16}
                    value={customHeight}
                    onChange={(event) => setCustomHeight(Number(event.target.value))}
                    className="mt-1 h-10 w-full rounded-xl border border-border bg-background/70 px-3 text-sm outline-none focus:border-[#5B7CFF]"
                  />
                </div>
                {customSizeError && <p className="col-span-2 text-xs text-red-500">{customSizeError}</p>}
              </div>
            )}

            <Button className="w-full" disabled={loading || !prompt.trim() || Boolean(customSizeError)} onClick={() => createImage()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
              {loading ? "生成中…" : "生成图片"}
            </Button>
            {pendingJobs.length > 0 && (
              <p className="text-center text-xs text-muted-foreground">队列中有 {pendingJobs.length} 个任务，完成后会自动更新预览。</p>
            )}
          </div>
        </Card>

        <Card className="min-h-[640px] overflow-hidden p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">预览</h2>
              <p className="mt-1 text-sm text-muted-foreground">{image ? "生成结果已准备好。" : "输入 Prompt 后开始创作。"}</p>
            </div>
            {image && (
              <Button variant="secondary" size="sm" onClick={() => downloadBase64(image)}>
                <Download className="h-4 w-4" />
                下载
              </Button>
            )}
          </div>

          <div className="mt-5 grid min-h-[520px] place-items-center rounded-2xl border border-border bg-background/60">
            {loading ? (
              <div className="w-full max-w-md space-y-4 p-8">
                <div className="aspect-square animate-pulse rounded-3xl bg-[#5B7CFF]/10" />
                <div className="h-3 animate-pulse rounded-full bg-muted" />
                <div className="h-3 w-2/3 animate-pulse rounded-full bg-muted" />
                <p className="text-center text-sm text-muted-foreground">任务已提交，后台生成中…</p>
              </div>
            ) : image ? (
              <motion.img
                key={image.slice(0, 32)}
                src={`data:image/png;base64,${image}`}
                alt="AI generated result"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="max-h-[680px] w-full rounded-2xl object-contain p-3"
              />
            ) : (
              <div className="text-center">
                <ImageIcon className="mx-auto h-10 w-10 text-[#5B7CFF]" />
                <h3 className="mt-4 text-lg font-semibold">暂无图片</h3>
                <p className="mt-2 text-sm text-muted-foreground">你的生成结果会显示在这里。</p>
              </div>
            )}
          </div>
        </Card>

        <Card className="p-5 xl:col-span-2 2xl:col-span-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">最近生成</h3>
              <p className="mt-1 text-xs text-muted-foreground">保留最近 10 张，可预览和下载原图。</p>
            </div>
            <Button variant="secondary" size="icon" onClick={refreshImages} aria-label="刷新图片历史">
              {historyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            </Button>
          </div>

          <div className="mt-4 space-y-3">
            {historyLoading && recentImages.length === 0 ? (
              <div className="flex items-center gap-2 rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-[#5B7CFF]" />
                正在读取...
              </div>
            ) : recentImages.length === 0 ? (
              <div className="grid min-h-[220px] place-items-center rounded-2xl border border-dashed border-border bg-background/60 text-center">
                <div>
                  <ImageIcon className="mx-auto h-6 w-6 text-[#5B7CFF]" />
                  <p className="mt-3 text-sm font-medium">还没有图片</p>
                  <p className="mt-1 text-xs text-muted-foreground">生成后会自动保存。</p>
                </div>
              </div>
            ) : (
              recentImages.map((record) => (
                <div key={record.id} className="flex gap-3 rounded-2xl border border-border bg-background/70 p-2 transition hover:-translate-y-0.5 hover:border-[#5B7CFF]/50">
                  <button className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-muted" onClick={() => openHistoryImage(record)}>
                    <img src={`data:image/png;base64,${record.image_base64}`} alt={record.prompt} className="h-full w-full object-cover" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <button className="line-clamp-2 text-left text-sm font-semibold" onClick={() => openHistoryImage(record)}>
                      {record.prompt}
                    </button>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {record.style} · {record.size}
                    </div>
                    <Button variant="ghost" size="sm" className="mt-2 h-8 px-2" onClick={() => downloadBase64(record.image_base64, `aiweb-image-${record.id}.png`)}>
                      <Download className="h-3.5 w-3.5" />
                      原图
                    </Button>
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
