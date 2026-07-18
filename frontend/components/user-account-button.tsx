"use client";

import Link from "next/link";
import { LogIn, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { getStoredUser, type User } from "@/lib/api";

export function UserAccountButton() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    setUser(getStoredUser());
  }, []);

  if (!user) {
    return (
      <Link
        href="/login"
        className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-2.5 text-sm font-semibold transition hover:bg-black/[0.04] dark:hover:bg-white/[0.06] min-[380px]:px-3"
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
      className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-2.5 pr-3 text-sm font-semibold transition hover:-translate-y-0.5 hover:border-[#5B7CFF]/50 hover:bg-[#5B7CFF]/5"
      title="账号信息"
    >
      <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[#5B7CFF] to-[#8A5CFF] text-xs font-semibold text-white shadow-lg shadow-blue-500/20">
        {initial}
      </span>
      <span className="hidden max-w-[120px] truncate sm:inline">{user.name || user.username}</span>
      <UserRound className="h-4 w-4 text-muted-foreground" />
    </Link>
  );
}
