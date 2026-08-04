"use client";

import { Activity } from "lucide-react";
import { usePathname } from "next/navigation";

import { BackgroundToggle } from "@/components/background-toggle";
import { CommandMenu } from "@/components/command-menu";
import { InspirationCapsule } from "@/components/inspiration-capsule";
import { ThemeToggle } from "@/components/theme-toggle";
import { TransparencyControl } from "@/components/transparency-control";
import { UserAccountButton } from "@/components/user-account-button";

const pageMeta: Record<string, { eyebrow: string; title: string }> = {
  "/": { eyebrow: "WORKSPACE / OVERVIEW", title: "创作控制台" },
  "/chat": { eyebrow: "WORKSPACE / LANGUAGE", title: "AI 对话" },
  "/image": { eyebrow: "WORKSPACE / VISION", title: "视觉工坊" },
  "/workflows": { eyebrow: "WORKSPACE / AUTOMATION", title: "工作流实验室" },
  "/runs": { eyebrow: "AUTOMATION / RUNTIME", title: "执行控制台" },
  "/studio": { eyebrow: "WORKSPACE / CREATIVE OS", title: "创作中枢" },
  "/history": { eyebrow: "WORKSPACE / ARCHIVE", title: "创作档案" },
  "/settings": { eyebrow: "SYSTEM / PREFERENCES", title: "偏好设置" },
  "/account": { eyebrow: "SYSTEM / ACCOUNT", title: "账户中心" },
  "/login": { eyebrow: "ACCESS / SIGN IN", title: "登录" },
  "/register": { eyebrow: "ACCESS / REGISTER", title: "创建账号" }
};

export function Topbar() {
  const pathname = usePathname();
  const meta = pageMeta[pathname] ?? pageMeta["/"];

  return (
    <header className="topbar mx-auto flex w-full max-w-[1720px] items-center justify-between gap-3 pb-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase text-muted-foreground">
          <Activity className="h-3 w-3 text-[#2DD4BF]" />
          <span className="truncate">{meta.eyebrow}</span>
        </div>
        <h1 className="mt-1 truncate text-xl font-semibold text-foreground sm:text-2xl">{meta.title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <InspirationCapsule />
        <CommandMenu />
        <div className="hidden items-center gap-2 sm:flex">
          <TransparencyControl />
          <BackgroundToggle />
          <ThemeToggle />
        </div>
        <UserAccountButton />
      </div>
    </header>
  );
}
