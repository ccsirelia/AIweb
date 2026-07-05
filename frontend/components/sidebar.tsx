"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { History, ImageIcon, LayoutDashboard, LogIn, LogOut, MessageSquareText, Settings, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { clearAuthSession, getStoredUser, type User } from "@/lib/api";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/chat", label: "GPT 聊天", icon: MessageSquareText },
  { href: "/image", label: "AI 生图", icon: ImageIcon },
  { href: "/history", label: "历史记录", icon: History },
  { href: "/settings", label: "设置", icon: Settings }
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    setUser(getStoredUser());
  }, [pathname]);

  function logout() {
    clearAuthSession();
    setUser(null);
    router.push("/login");
  }

  return (
    <aside className="sticky top-0 z-20 flex h-auto w-full flex-col border-b border-border bg-card/76 px-4 py-4 backdrop-blur-2xl lg:h-screen lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
      <Link href="/" className="mb-4 flex items-center gap-3 lg:mb-8">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#1A1A1A] text-white shadow-soft dark:bg-white dark:text-[#1A1A1A]">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <div className="text-base font-semibold">AIWeb</div>
          <div className="text-xs text-muted-foreground">Creative Intelligence</div>
        </div>
      </Link>

      <nav className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
        {navItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex min-w-fit items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-muted-foreground transition-all hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]",
                active && "bg-[#5B7CFF] text-white shadow-lg shadow-blue-500/20 hover:bg-[#5B7CFF] hover:text-white"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto hidden rounded-2xl border border-border bg-background/70 p-4 lg:block">
        {user ? (
          <>
            <div className="text-sm font-semibold">{user.name}</div>
            <p className="mt-1 text-xs text-muted-foreground">@{user.username}</p>
            <button onClick={logout} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-medium">
              <LogOut className="h-4 w-4" />
              退出登录
            </button>
          </>
        ) : (
          <Link href="/login" className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-[#5B7CFF] text-sm font-medium text-white">
            <LogIn className="h-4 w-4" />
            登录
          </Link>
        )}
      </div>
    </aside>
  );
}
