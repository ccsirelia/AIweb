"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Loader2, LogIn, Sparkles, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { login, register, setAuthSession } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageShell } from "@/components/page-shell";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const isRegister = mode === "register";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    try {
      const payload = isRegister
        ? await register({
            username: String(form.get("username") ?? ""),
            name: String(form.get("name") ?? ""),
            email: String(form.get("email") ?? ""),
            password: String(form.get("password") ?? "")
          })
        : await login({
            account: String(form.get("account") ?? ""),
            password: String(form.get("password") ?? "")
          });
      setAuthSession(payload);
      toast.success(isRegister ? "注册成功，欢迎来到 AIWeb。" : "登录成功。");
      router.push("/chat");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "认证失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell>
      <div className="mx-auto grid min-h-[72vh] max-w-md place-items-center">
        <Card className="w-full p-7">
          <div className="text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#1A1A1A] text-white dark:bg-white dark:text-[#1A1A1A]">
              <Sparkles className="h-5 w-5" />
            </div>
            <h2 className="mt-5 text-2xl font-semibold">{isRegister ? "创建账号" : "欢迎回来"}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {isRegister ? "注册后可保存自己的对话和图片历史。" : "登录后继续你的 AI 创作会话。"}
            </p>
          </div>

          <form className="mt-7 space-y-4" onSubmit={submit}>
            {isRegister ? (
              <>
                <input name="name" required placeholder="姓名" className="h-11 w-full rounded-xl border border-border bg-background/70 px-4 text-sm outline-none focus:border-[#5B7CFF]" />
                <input name="username" required minLength={3} placeholder="用户名，不能重复" className="h-11 w-full rounded-xl border border-border bg-background/70 px-4 text-sm outline-none focus:border-[#5B7CFF]" />
                <input name="email" required type="email" placeholder="邮箱" className="h-11 w-full rounded-xl border border-border bg-background/70 px-4 text-sm outline-none focus:border-[#5B7CFF]" />
              </>
            ) : (
              <input name="account" required placeholder="用户名或邮箱" className="h-11 w-full rounded-xl border border-border bg-background/70 px-4 text-sm outline-none focus:border-[#5B7CFF]" />
            )}
            <input name="password" required minLength={6} type="password" placeholder="密码" className="h-11 w-full rounded-xl border border-border bg-background/70 px-4 text-sm outline-none focus:border-[#5B7CFF]" />
            <Button className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : isRegister ? <UserPlus className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
              {isRegister ? "注册并登录" : "登录"}
            </Button>
          </form>

          <div className="mt-5 text-center text-sm text-muted-foreground">
            {isRegister ? "已有账号？" : "还没有账号？"}
            <Link className="ml-2 font-semibold text-[#5B7CFF]" href={isRegister ? "/login" : "/register"}>
              {isRegister ? "去登录" : "立即注册"}
            </Link>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
