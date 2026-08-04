"use client";

import { Check, Cpu, ImageIcon, MonitorCog, Moon, RefreshCcw, Server, Sun, Waves, Workflow } from "lucide-react";
import { useTheme } from "next-themes";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useBackground } from "@/components/background-provider";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useTransparency } from "@/components/transparency-provider";
import { getHealth } from "@/lib/api";
import { cn } from "@/lib/utils";

export function PreferencesPanel() {
  const { background, setBackground } = useBackground();
  const { transparency, setTransparency } = useTransparency();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    setMounted(true);
    getHealth().then(() => setOnline(true)).catch(() => setOnline(false));
  }, []);

  function resetAppearance() {
    setTheme("dark");
    setBackground("classic");
    setTransparency(88);
    toast.success("外观偏好已恢复默认。 ");
  }

  return (
    <PageShell className="space-y-4">
      <section className="grid gap-4 xl:grid-cols-[1fr_0.72fr]">
        <Card className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">APPEARANCE</div>
              <h2 className="mt-1 text-lg font-semibold">界面外观</h2>
            </div>
            <MonitorCog className="h-5 w-5 text-[#5B7CFF]" />
          </div>

          <div className="mt-6 space-y-6">
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">主题</div>
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-background/50 p-1">
                {[
                  { value: "dark", label: "深色", icon: Moon },
                  { value: "light", label: "浅色", icon: Sun }
                ].map((item) => {
                  const Icon = item.icon;
                  const selected = mounted && resolvedTheme === item.value;
                  return (
                    <button key={item.value} type="button" onClick={() => setTheme(item.value)} className={cn("flex h-10 items-center justify-center gap-2 rounded-md text-sm transition", selected ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                      <Icon className="h-4 w-4" />
                      {item.label}
                      {selected ? <Check className="h-3.5 w-3.5 text-[#2DD4BF]" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">背景</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: "classic" as const, label: "科技网格", icon: Waves, color: "#2DD4BF" },
                  { value: "portrait" as const, label: "人物画布", icon: ImageIcon, color: "#FB7185" }
                ].map((item) => {
                  const Icon = item.icon;
                  const selected = background === item.value;
                  return (
                    <button key={item.value} type="button" onClick={() => setBackground(item.value)} className={cn("flex min-h-20 items-center gap-3 rounded-lg border p-3 text-left transition", selected ? "border-[#5B7CFF]/45 bg-[#5B7CFF]/8" : "border-border bg-background/40 hover:border-white/20")}>
                      <span className="grid h-9 w-9 place-items-center rounded-md" style={{ color: item.color, backgroundColor: `${item.color}14` }}><Icon className="h-4 w-4" /></span>
                      <span className="text-sm font-medium">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="settings-transparency" className="font-medium text-muted-foreground">卡片通透度</label>
                <output className="font-semibold tabular-nums text-foreground">{transparency}%</output>
              </div>
              <input id="settings-transparency" type="range" min={55} max={96} value={transparency} onChange={(event) => setTransparency(Number(event.target.value))} className="transparency-slider mt-4 w-full" style={{ "--slider-progress": `${((transparency - 55) / 41) * 100}%` } as CSSProperties} />
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase text-muted-foreground">RUNTIME</div>
                <h2 className="mt-1 text-lg font-semibold">服务连接</h2>
              </div>
              <span className={cn("inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs", online === false ? "border-red-500/25 bg-red-500/8 text-red-400" : "border-[#2DD4BF]/25 bg-[#2DD4BF]/8 text-[#2DD4BF]")}>
                <span className={cn("h-1.5 w-1.5 rounded-full", online === false ? "bg-red-400" : "bg-[#2DD4BF]")} />
                {online === null ? "检测中" : online ? "连接正常" : "连接失败"}
              </span>
            </div>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">敏感配置由服务端隔离管理，前台仅接收匿名运行状态。</p>
            <div className="mt-5 grid gap-2 text-xs sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              {[
                { label: "后端网关", value: online ? "已连接" : "待连接", icon: Server, color: online ? "#2DD4BF" : "#FB7185" },
                { label: "创作任务", value: "已就绪", icon: Workflow, color: "#5B7CFF" },
                { label: "模型通道", value: "已挂载", icon: Cpu, color: "#FBBF24" }
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="rounded-md border border-border bg-background/45 p-3">
                    <Icon className="h-3.5 w-3.5" style={{ color: item.color }} />
                    <div className="mt-2 text-muted-foreground">{item.label}</div>
                    <div className="mt-1 font-semibold text-foreground">{item.value}</div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-5">
            <div className="text-[10px] font-semibold uppercase text-muted-foreground">RESET</div>
            <h2 className="mt-1 text-lg font-semibold">恢复默认外观</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">仅重置主题、背景和通透度，不会清除账号、会话或进行中的任务。</p>
            <Button variant="secondary" size="sm" className="mt-5" onClick={resetAppearance}>
              <RefreshCcw className="h-4 w-4" />
              恢复默认
            </Button>
          </Card>
        </div>
      </section>
    </PageShell>
  );
}
