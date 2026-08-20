"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowUpRight,
  Activity,
  Bot,
  Boxes,
  CheckCircle2,
  ImageIcon,
  MessageSquareText,
  PenTool,
  ScanLine,
  Sparkles,
  Star,
  WandSparkles,
  Workflow,
  Zap
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { getAccountProfile, getAuthToken, getHealth, getImageContent, getStoredUser, type AccountProfile } from "@/lib/api";
import {
  WORKFLOW_LIBRARY_CHANGED_EVENT,
  WORKFLOW_USAGE_CHANGED_EVENT,
  builtInWorkflows,
  loadCustomWorkflows,
  loadWorkflowUsage,
  type WorkflowTemplate,
  type WorkflowUsageState
} from "@/lib/workflows";

const recipes = [
  {
    title: "提炼复杂材料",
    description: "把长文整理成结论、风险与行动项",
    prompt: "请将我接下来提供的材料整理为：核心结论、关键证据、潜在风险和下一步行动。",
    href: "/chat",
    icon: ScanLine,
    color: "#2DD4BF"
  },
  {
    title: "产品视觉提案",
    description: "生成商业级产品主视觉提示词",
    prompt: "高端科技产品主视觉，深色工作室，精密材质，克制的青绿色轮廓光，商业摄影，清晰细节",
    href: "/image",
    icon: WandSparkles,
    color: "#FB7185"
  },
  {
    title: "内容结构设计",
    description: "从目标到大纲快速建立叙事骨架",
    prompt: "请围绕我的主题设计一份内容结构，包含目标读者、核心论点、章节大纲和每节的关键信息。",
    href: "/chat",
    icon: PenTool,
    color: "#FBBF24"
  }
];

const PENDING_PROMPT_KEY = "aiweb:pending-prompt";

function compactNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

export function Dashboard() {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [user, setUser] = useState<ReturnType<typeof getStoredUser>>(null);
  const [recentImageUrl, setRecentImageUrl] = useState("");
  const [customWorkflows, setCustomWorkflows] = useState<WorkflowTemplate[]>([]);
  const [workflowUsage, setWorkflowUsage] = useState<WorkflowUsageState>({ favorites: [], recent: [], useCounts: {} });

  useEffect(() => {
    setUser(getStoredUser());
    getHealth().then(() => setOnline(true)).catch(() => setOnline(false));
    if (getAuthToken()) getAccountProfile().then(setProfile).catch(() => setProfile(null));
  }, []);

  const recentImageId = profile?.recent_images[0]?.id ?? null;
  useEffect(() => {
    if (!recentImageId) {
      setRecentImageUrl("");
      return;
    }
    let active = true;
    let objectUrl = "";
    getImageContent(recentImageId, "original")
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setRecentImageUrl(objectUrl);
      })
      .catch(() => {
        if (active) setRecentImageUrl("");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [recentImageId]);

  useEffect(() => {
    const refresh = () => {
      setCustomWorkflows(loadCustomWorkflows());
      setWorkflowUsage(loadWorkflowUsage());
    };
    refresh();
    window.addEventListener(WORKFLOW_LIBRARY_CHANGED_EVENT, refresh);
    window.addEventListener(WORKFLOW_USAGE_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(WORKFLOW_LIBRARY_CHANGED_EVENT, refresh);
      window.removeEventListener(WORKFLOW_USAGE_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 6 ? "夜深了" : hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  const displayName = user?.name || user?.username || "创作者";
  const recentImage = profile?.recent_images[0];
  const allWorkflows = useMemo(() => [...customWorkflows, ...builtInWorkflows], [customWorkflows]);
  const workflowPulse = useMemo(() => {
    const recent = workflowUsage.recent
      .map((entry) => allWorkflows.find((workflow) => workflow.id === entry.workflowId))
      .filter((workflow): workflow is WorkflowTemplate => Boolean(workflow));
    return (recent.length ? recent : builtInWorkflows).slice(0, 3);
  }, [allWorkflows, workflowUsage.recent]);

  return (
    <PageShell className="space-y-4">
      <section className="command-hero relative grid min-h-[330px] overflow-hidden rounded-lg border border-border lg:grid-cols-[1.1fr_0.9fr]">
        <div className="relative z-10 flex flex-col justify-between p-6 sm:p-8 lg:p-10">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-md border border-[#2DD4BF]/25 bg-[#2DD4BF]/8 px-2.5 py-1 text-[11px] font-semibold text-[#2DD4BF]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#2DD4BF] shadow-[0_0_10px_#2DD4BF]" />
                {online === false ? "服务离线" : online === true ? "系统就绪" : "正在连接"}
              </span>
              <span className="text-xs text-muted-foreground">OpenAI + Grok creative stack</span>
            </div>
            <h2 className="mt-7 max-w-2xl text-3xl font-semibold leading-tight text-foreground sm:text-4xl lg:text-5xl">
              {greeting}，<span className="[overflow-wrap:anywhere]">{displayName}</span>。
              <span className="mt-2 block text-muted-foreground">今天准备创造什么？</span>
            </h2>
            <p className="mt-5 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
              在同一个工作区完成推理、写作、视觉探索和创作归档，让每次灵感都能快速进入产出。
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-2.5">
            <Link href="/chat" className="inline-flex h-10 items-center gap-2 rounded-md bg-[#5B7CFF] px-4 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition hover:bg-[#466BFF]">
              <MessageSquareText className="h-4 w-4" />
              新建对话
            </Link>
            <Link href="/image" className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card/70 px-4 text-sm font-medium transition hover:border-[#FB7185]/45 hover:text-[#FB7185]">
              <ImageIcon className="h-4 w-4" />
              创建图像
            </Link>
            <Link href="/workflows" className="inline-flex h-10 items-center gap-2 rounded-md border border-[#A78BFA]/30 bg-[#A78BFA]/8 px-4 text-sm font-medium text-[#A78BFA] transition hover:border-[#A78BFA]/55 hover:bg-[#A78BFA]/12">
              <Workflow className="h-4 w-4" />
              编排工作流
            </Link>
          </div>
        </div>

        <div className="relative min-h-[260px] overflow-hidden border-t border-border lg:border-l lg:border-t-0">
          {recentImage && recentImageUrl ? (
            <img src={recentImageUrl} alt={recentImage.prompt} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <Image src="/images/portrait-theme.png" alt="AI 视觉作品预览" fill priority sizes="(min-width: 1024px) 42vw, 100vw" className="object-cover object-[72%_center]" />
          )}
          <div className="absolute inset-0 bg-black/10 dark:bg-black/25" />
          <div className="absolute inset-x-4 bottom-4 rounded-md border border-white/20 bg-black/45 p-3 text-white backdrop-blur-md sm:inset-x-5 sm:bottom-5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase text-white/55">VISUAL CHANNEL</div>
                <div className="mt-1 truncate text-sm font-medium">{recentImage?.prompt || "视觉工作区已待命"}</div>
              </div>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#FB7185] text-white">
                <Sparkles className="h-4 w-4" />
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <div>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">QUICK START</div>
              <h3 className="mt-1 text-lg font-semibold">创作模板</h3>
            </div>
            <Link href="/workflows" className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground">
              管理模板 <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {recipes.map((recipe) => {
              const Icon = recipe.icon;
              return (
                <Link
                  key={recipe.title}
                  href={recipe.href}
                  onClick={(event) => {
                    try {
                      sessionStorage.setItem(PENDING_PROMPT_KEY, JSON.stringify({
                        prompt: recipe.prompt,
                        target: recipe.href === "/image" ? "image" : "chat"
                      }));
                    } catch {
                      event.preventDefault();
                      toast.error("无法暂存模板内容，请检查浏览器存储权限。");
                    }
                  }}
                  className="group"
                >
                  <Card className="h-full p-4 transition hover:-translate-y-0.5 hover:border-white/20">
                    <div className="flex items-start justify-between gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-md" style={{ color: recipe.color, backgroundColor: `${recipe.color}16` }}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <ArrowUpRight className="h-4 w-4 text-muted-foreground transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </div>
                    <div className="mt-5 text-sm font-semibold">{recipe.title}</div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{recipe.description}</p>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-3">
            <div className="text-[10px] font-semibold uppercase text-muted-foreground">SIGNALS</div>
            <h3 className="mt-1 text-lg font-semibold">工作区信号</h3>
          </div>
          <Card className="divide-y divide-border overflow-hidden">
            <div className="grid grid-cols-2 gap-3 p-4">
              <div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Zap className="h-3.5 w-3.5 text-[#FBBF24]" />累计用量</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums">{profile ? compactNumber(profile.token_usage.total_tokens) : "--"}</div>
              </div>
              <div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Boxes className="h-3.5 w-3.5 text-[#FB7185]" />最近作品</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums">{profile ? profile.recent_images.length : "--"}</div>
              </div>
            </div>
            <div className="space-y-3 p-4 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-muted-foreground"><Bot className="h-3.5 w-3.5 text-[#5B7CFF]" />语言模型</span>
                <span className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="h-3.5 w-3.5 text-[#2DD4BF]" />已挂载</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-muted-foreground"><ImageIcon className="h-3.5 w-3.5 text-[#FB7185]" />视觉模型</span>
                <span className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="h-3.5 w-3.5 text-[#2DD4BF]" />已挂载</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-muted-foreground"><Workflow className="h-3.5 w-3.5 text-[#A78BFA]" />工作流网络</span>
                <span className="font-mono font-medium tabular-nums">{allWorkflows.length} NODES</span>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase text-muted-foreground"><Activity className="h-3 w-3 text-[#2DD4BF]" />WORKFLOW PULSE</div>
            <h3 className="mt-1 text-lg font-semibold">{workflowUsage.recent.length ? "最近装载的链路" : "推荐工作流"}</h3>
          </div>
          <Link href="/workflows" className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground">打开实验室 <ArrowUpRight className="h-3.5 w-3.5" /></Link>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {workflowPulse.map((workflow, index) => {
            const runs = workflowUsage.useCounts[workflow.id] ?? 0;
            const favorite = workflowUsage.favorites.includes(workflow.id);
            return (
              <Link key={workflow.id} href={{ pathname: "/workflows", query: { workflow: workflow.id } }} className="group block min-w-0">
                <Card className="relative h-full overflow-hidden p-4 transition hover:-translate-y-0.5" style={{ borderColor: `${workflow.accent}32` }}>
                  <span className="absolute inset-y-4 left-0 w-0.5" style={{ backgroundColor: workflow.accent, boxShadow: `0 0 14px ${workflow.accent}66` }} />
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-md font-mono text-[10px] font-bold" style={{ color: workflow.accent, backgroundColor: `${workflow.accent}16` }}>{String(index + 1).padStart(2, "0")}</span>
                    {favorite ? <Star className="h-3.5 w-3.5 fill-[#FBBF24] text-[#FBBF24]" /> : <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />}
                  </div>
                  <h4 className="mt-4 truncate text-sm font-semibold">{workflow.name}</h4>
                  <p className="mt-1.5 line-clamp-2 text-[11px] leading-5 text-muted-foreground">{workflow.description}</p>
                  <div className="mt-4 flex flex-wrap gap-1.5 font-mono text-[9px] text-muted-foreground">
                    <span>{workflow.fields.length} INPUTS</span><span>·</span><span>{workflow.steps.length} NODES</span><span>·</span><span>{runs} USES</span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>
    </PageShell>
  );
}
