"use client";

import Link from "next/link";
import { LogIn, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { AUTH_CHANGED_EVENT, getStoredUser, type User } from "@/lib/api";

export function UserAccountButton() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const refreshUser = () => setUser(getStoredUser());
    refreshUser();
    window.addEventListener(AUTH_CHANGED_EVENT, refreshUser);
    window.addEventListener("storage", refreshUser);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, refreshUser);
      window.removeEventListener("storage", refreshUser);
    };
  }, []);

  if (!user) {
    return (
      <Link
        href="/login"
        className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-sm font-semibold transition hover:border-[#2DD4BF]/40 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] min-[380px]:px-3"
        aria-label="登录"
      >
        <LogIn className="h-4 w-4 text-[#5B7CFF]" />
        <span className="hidden min-[380px]:inline">登录</span>
      </Link>
    );
  }

  const initial = (user.name || user.username || "A").slice(0, 1).toUpperCase();

  return (
    <Link
      href="/account"
      className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-1.5 pr-2.5 text-sm font-semibold transition hover:border-[#2DD4BF]/40 hover:bg-[#2DD4BF]/5"
      aria-label="打开账户中心"
      title="账号信息"
    >
      <span className="grid h-7 w-7 place-items-center rounded-md bg-[#5B7CFF] text-xs font-semibold text-white shadow-lg shadow-blue-500/20">
        {initial}
      </span>
      <span className="hidden max-w-[120px] truncate sm:inline">{user.name || user.username}</span>
      <UserRound className="h-4 w-4 text-muted-foreground" />
    </Link>
  );
}
