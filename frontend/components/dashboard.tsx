import Link from "next/link";
import { ArrowRight, ImageIcon, MessageSquareText, ShieldCheck, WandSparkles } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";

const metrics = [
  ["文字创作", "Responses API", MessageSquareText],
  ["视觉生成", "Image API", ImageIcon],
  ["私密架构", "Server-side Key", ShieldCheck]
];

export function Dashboard() {
  return (
    <PageShell>
      <section className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="glass-panel rounded-[2rem] p-7 shadow-soft sm:p-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground">
            <WandSparkles className="h-3.5 w-3.5 text-[#5B7CFF]" />
            AI 创作工作台
          </div>
          <h2 className="mt-8 max-w-3xl text-4xl font-semibold tracking-normal text-foreground sm:text-6xl">
            把文字、图像和灵感收束进一个高级创作空间。
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
            面向商业内容、视觉探索和产品创意的全栈 AI Studio，前后端分离，内置历史记录、加载状态和可扩展的服务层。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/chat"
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#5B7CFF] px-5 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition hover:scale-[1.02] hover:bg-[#466BFF]"
            >
              开始对话
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/image"
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-5 text-sm font-medium transition hover:scale-[1.02]"
            >
              进入生图
              <ImageIcon className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="grid gap-4">
          {metrics.map(([title, value, Icon]) => (
            <Card key={title as string} className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted-foreground">{title as string}</div>
                  <div className="mt-2 text-2xl font-semibold">{value as string}</div>
                </div>
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#5B7CFF]/10 text-[#5B7CFF]">
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
