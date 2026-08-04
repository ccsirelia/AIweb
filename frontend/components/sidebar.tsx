"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Archive, FolderKanban, Gauge, ImageIcon, LayoutDashboard, LogIn, LogOut, MessageSquareText, Settings, Sparkles, UserRound, Workflow } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AUTH_CHANGED_EVENT, clearAuthSession, getHealth, getStoredUser, type User } from "@/lib/api";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "控制台", icon: LayoutDashboard, accent: "#5B7CFF" },
  { href: "/chat", label: "AI 对话", icon: MessageSquareText, accent: "#2DD4BF" },
  { href: "/image", label: "视觉工坊", icon: ImageIcon, accent: "#FB7185" },
  { href: "/workflows", label: "工作流实验室", icon: Workflow, accent: "#A78BFA" },
  { href: "/runs", label: "执行控制台", icon: Gauge, accent: "#38BDF8" },
  { href: "/studio", label: "创作中枢", icon: FolderKanban, accent: "#34D399" },
  { href: "/history", label: "创作档案", icon: Archive, accent: "#FBBF24" },
  { href: "/settings", label: "偏好设置", icon: Settings, accent: "#94A3B8" }
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const activeNavItemRef = useRef<HTMLAnchorElement | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const refreshUser = () => setUser(getStoredUser());
    refreshUser();
    getHealth().then(() => setOnline(true)).catch(() => setOnline(false));
    window.addEventListener(AUTH_CHANGED_EVENT, refreshUser);
    window.addEventListener("storage", refreshUser);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, refreshUser);
      window.removeEventListener("storage", refreshUser);
    };
  }, [pathname]);

  useEffect(() => {
    if (window.innerWidth >= 1024) return;
    const frame = window.requestAnimationFrame(() => {
      activeNavItemRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  function logout() {
    clearAuthSession();
    setUser(null);
    router.push("/login");
  }

  return (
    <aside className="site-sidebar sticky top-0 z-30 flex h-auto w-full flex-col border-b border-border px-3 py-3 backdrop-blur-2xl lg:h-screen lg:border-b-0 lg:border-r lg:px-3 lg:py-4">
      <div className="flex items-center justify-between lg:block">
        <Link href="/" className="flex items-center gap-3 rounded-md px-1 py-1 lg:px-2">
          <div className="brand-mark relative grid h-9 w-9 place-items-center overflow-hidden rounded-md border border-white/10 bg-[#11141B] text-white">
            <Sparkles className="relative z-10 h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">AIWeb Studio</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className={cn("h-1.5 w-1.5 rounded-full", online === false ? "bg-[#FB7185] shadow-[0_0_8px_#FB7185]" : "bg-[#2DD4BF] shadow-[0_0_8px_#2DD4BF]")} />
              {online === null ? "Connecting system" : online ? "Creative system online" : "Service unavailable"}
            </div>
          </div>
        </Link>
      </div>

      <nav className="soft-scrollbar mt-3 flex gap-1 overflow-x-auto pb-1 lg:mt-8 lg:flex-col lg:gap-1 lg:overflow-visible">
        {navItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              ref={active ? activeNavItemRef : undefined}
              className={cn(
                "group relative flex min-w-fit items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-sm font-medium text-muted-foreground transition-all",
                "hover:border-border hover:bg-black/[0.03] hover:text-foreground dark:hover:bg-white/[0.04]",
                active && "border-border bg-card text-foreground shadow-sm"
              )}
            >
              <span
                className="grid h-7 w-7 place-items-center rounded-md"
                style={{ backgroundColor: `${item.accent}${active ? "1f" : "12"}`, color: item.accent }}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              {item.label}
              {active ? <span className="absolute right-1.5 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.accent, boxShadow: `0 0 10px ${item.accent}` }} /> : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto hidden border-t border-border pt-3 lg:block">
        {user ? (
          <div className="space-y-1">
            <Link href="/account" className="flex items-center gap-3 rounded-md px-2 py-2 transition hover:bg-black/[0.04] dark:hover:bg-white/[0.05]">
              <div className="grid h-8 w-8 place-items-center rounded-md bg-[#A78BFA]/12 text-[#A78BFA]">
                <UserRound className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold">{user.name}</div>
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">@{user.username}</p>
              </div>
            </Link>
            <button onClick={logout} className="flex h-9 w-full items-center gap-3 rounded-md px-3 text-xs text-muted-foreground transition hover:bg-red-500/10 hover:text-red-400">
              <LogOut className="h-3.5 w-3.5" />
              退出登录
            </button>
          </div>
        ) : (
          <Link href="/login" className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#5B7CFF] text-xs font-medium text-white">
            <LogIn className="h-3.5 w-3.5" />
            登录
          </Link>
        )}
      </div>
    </aside>
  );
}
