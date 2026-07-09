"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Download, ImageIcon, Loader2, Mail, ShieldCheck, UserRound, WalletCards } from "lucide-react";
import { toast } from "sonner";

import { getAccountProfile, getAuthToken, type AccountProfile, type ImageRecord } from "@/lib/api";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function downloadBase64Image(record: ImageRecord) {
  const link = document.createElement("a");
  link.href = `data:image/png;base64,${record.image_base64}`;
  link.download = `aiweb-image-${record.id}.png`;
  link.click();
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
                    <img src={`data:image/png;base64,${record.image_base64}`} alt={record.prompt} className="h-full w-full object-cover" />
                  </div>
                  <div className="space-y-3 p-3">
                    <div>
                      <div className="line-clamp-2 text-sm font-semibold">{record.prompt}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {record.style} · {record.size} · {new Date(record.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <Button variant="secondary" size="sm" className="w-full" onClick={() => downloadBase64Image(record)}>
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
