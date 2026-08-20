"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Download, ImageIcon, KeyRound, Loader2, Mail, ShieldCheck, UserRound, WalletCards } from "lucide-react";
import { toast } from "sonner";

import { changePassword, getAccountProfile, getAuthToken, getImageContent, setAuthSession, type AccountProfile, type ImageRecord } from "@/lib/api";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

async function downloadImage(record: ImageRecord) {
  const blob = await getImageContent(record.id);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `aiweb-image-${record.id}.png`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function RecentImagePreview({ record }: { record: ImageRecord }) {
  const [thumbnailUrl, setThumbnailUrl] = useState("");

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    getImageContent(record.id, "thumb")
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setThumbnailUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [record.id]);

  return thumbnailUrl ? (
    <img src={thumbnailUrl} alt={record.prompt} loading="lazy" className="h-full w-full object-cover" />
  ) : (
    <div className="grid h-full place-items-center text-xs text-muted-foreground">缩略图加载中</div>
  );
}

function StatCard({ label, value, desc }: { label: string; value: number; desc: string }) {
  return (
    <Card className="p-5 transition hover:-translate-y-0.5 hover:border-[#5B7CFF]/40">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#5B7CFF]/10 text-[#5B7CFF]">
          <WalletCards className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-4 text-3xl font-semibold tracking-normal">{formatNumber(value)}</div>
      <p className="mt-2 text-xs text-muted-foreground">{desc}</p>
    </Card>
  );
}

export function AccountProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("current_password") || "");
    const newPassword = String(data.get("new_password") || "");
    const confirmPassword = String(data.get("confirm_password") || "");
    if (newPassword !== confirmPassword) {
      toast.error("两次输入的新密码不一致。");
      return;
    }
    setPasswordLoading(true);
    try {
      const session = await changePassword({ current_password: currentPassword, new_password: newPassword });
      setAuthSession(session);
      form.reset();
      setPasswordOpen(false);
      toast.success("密码已更新。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "密码修改失败。");
    } finally {
      setPasswordLoading(false);
    }
  }

  useEffect(() => {
    if (!getAuthToken()) {
      router.push("/login");
      return;
    }

    async function loadProfile() {
      setLoading(true);
      try {
        setProfile(await getAccountProfile());
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "账号信息加载失败。");
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, [router]);

  if (loading) {
    return (
      <PageShell>
        <Card className="grid min-h-[420px] place-items-center">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-[#5B7CFF]" />
            正在读取账号信息...
          </div>
        </Card>
      </PageShell>
    );
  }

  if (!profile) {
    return (
      <PageShell>
        <Card className="grid min-h-[420px] place-items-center text-center">
          <div>
            <UserRound className="mx-auto h-8 w-8 text-[#5B7CFF]" />
            <h2 className="mt-4 text-lg font-semibold">暂时无法读取账号信息</h2>
            <p className="mt-2 text-sm text-muted-foreground">请稍后刷新页面重试。</p>
          </div>
        </Card>
      </PageShell>
    );
  }

  const user = profile.user;
  const initial = (user.name || user.username || "A").slice(0, 1).toUpperCase();

  return (
    <PageShell>
      <div className="space-y-5">
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-3xl bg-gradient-to-br from-[#5B7CFF] to-[#8A5CFF] text-xl font-semibold text-white shadow-lg shadow-blue-500/20">
                {initial}
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-2xl font-semibold tracking-normal">{user.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">@{user.username}</p>
              </div>
            </div>
            <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 md:min-w-[420px]">
              <div className="flex items-center gap-2 rounded-xl border border-border bg-background/70 px-3 py-2">
                <Mail className="h-4 w-4 text-[#5B7CFF]" />
                <span className="truncate">{user.email}</span>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-border bg-background/70 px-3 py-2">
                <ShieldCheck className="h-4 w-4 text-[#5B7CFF]" />
                <span>{user.role} · {user.is_active ? "正常" : "已停用"}</span>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-border bg-background/70 px-3 py-2 sm:col-span-2">
                <CalendarDays className="h-4 w-4 text-[#5B7CFF]" />
                <span>注册时间：{new Date(profile.created_at).toLocaleString()}</span>
              </div>
            </div>
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="历史总消耗" value={profile.token_usage.total_tokens} desc="当前账号累计 token 使用量" />
          <StatCard label="最近 7 天" value={profile.token_usage.last_7_days_tokens} desc="近 7 天对话和生图合计消耗" />
          <StatCard label="最近 24 小时" value={profile.token_usage.last_24_hours_tokens} desc="过去 24 小时内的活跃消耗" />
        </div>

        <Card className="overflow-hidden">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-md bg-[#2DD4BF]/10 text-[#2DD4BF]">
                <KeyRound className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-sm font-semibold">登录密码</h3>
                <p className="mt-1 text-xs text-muted-foreground">定期更新密码可降低账号风险。</p>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setPasswordOpen((value) => !value)}>
              {passwordOpen ? "收起" : "修改密码"}
            </Button>
          </div>
          {passwordOpen ? (
            <form onSubmit={submitPassword} className="grid gap-3 border-t border-border bg-background/35 p-5 md:grid-cols-3">
              <label className="text-xs font-medium text-muted-foreground">
                当前密码
                <input name="current_password" type="password" required autoComplete="current-password" className="mt-2 h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-[#2DD4BF]" />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                新密码
                <input name="new_password" type="password" required minLength={8} autoComplete="new-password" className="mt-2 h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-[#2DD4BF]" />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                确认新密码
                <input name="confirm_password" type="password" required minLength={8} autoComplete="new-password" className="mt-2 h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-[#2DD4BF]" />
              </label>
              <div className="md:col-span-3 md:justify-self-end">
                <Button size="sm" disabled={passwordLoading}>
                  {passwordLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  更新密码
                </Button>
              </div>
            </form>
          ) : null}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">最近生成图片</h3>
              <p className="mt-1 text-sm text-muted-foreground">展示最近 3 张图片，可直接下载原图。</p>
            </div>
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#5B7CFF]/10 text-[#5B7CFF]">
              <ImageIcon className="h-5 w-5" />
            </div>
          </div>

          {profile.recent_images.length === 0 ? (
            <div className="mt-5 grid min-h-[240px] place-items-center rounded-2xl border border-dashed border-border bg-background/60 text-center">
              <div>
                <ImageIcon className="mx-auto h-7 w-7 text-[#5B7CFF]" />
                <p className="mt-3 text-sm font-medium">还没有生成图片</p>
                <p className="mt-1 text-xs text-muted-foreground">去 AI 生图页面生成后，这里会展示最近作品。</p>
              </div>
            </div>
          ) : (
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {profile.recent_images.map((record) => (
                <div key={record.id} className="overflow-hidden rounded-2xl border border-border bg-background/70 transition hover:-translate-y-0.5 hover:border-[#5B7CFF]/50">
                  <div className="aspect-square bg-muted">
                    <RecentImagePreview record={record} />
                  </div>
                  <div className="space-y-3 p-3">
                    <div>
                      <div className="line-clamp-2 text-sm font-semibold">{record.prompt}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {record.style} · {record.size} · {new Date(record.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <Button variant="secondary" size="sm" className="w-full" onClick={() => void downloadImage(record).catch((error) => toast.error(error instanceof Error ? error.message : "原图下载失败。"))}>
                      <Download className="h-4 w-4" />
                      下载原图
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
