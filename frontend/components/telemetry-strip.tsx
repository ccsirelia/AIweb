"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Clock3,
  Gauge,
  MapPin,
  Radio,
  TimerReset,
  Wifi,
  WifiOff
} from "lucide-react";
import { usePathname } from "next/navigation";

type ConnectionInfo = EventTarget & {
  effectiveType?: string;
  rtt?: number;
};

type NavigatorWithConnection = Navigator & {
  connection?: ConnectionInfo;
  mozConnection?: ConnectionInfo;
  webkitConnection?: ConnectionInfo;
};

const routeNames: Record<string, string> = {
  "/": "创作控制台",
  "/chat": "AI 对话",
  "/image": "视觉工坊",
  "/presentations": "PPT 工坊",
  "/workflows": "工作流实验室",
  "/runs": "执行控制台",
  "/studio": "创作中枢",
  "/history": "创作档案",
  "/settings": "偏好设置",
  "/account": "账户中心",
  "/login": "登录",
  "/register": "创建账号"
};

const initialPulse = [3, 5, 4, 7, 3, 6, 8, 5, 4, 7, 5, 3];

function getConnection() {
  const target = navigator as NavigatorWithConnection;
  return target.connection ?? target.mozConnection ?? target.webkitConnection;
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((unit) => String(unit).padStart(2, "0")).join(":");
}

export function TelemetryStrip() {
  const pathname = usePathname();
  const startedAt = useRef(Date.now());
  const [now, setNow] = useState<Date | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [rtt, setRtt] = useState<number | null>(null);
  const [networkType, setNetworkType] = useState<string | null>(null);
  const [pulse, setPulse] = useState(initialPulse);

  const routeName = useMemo(() => {
    if (routeNames[pathname]) return routeNames[pathname];
    const parentRoute = Object.keys(routeNames)
      .filter((route) => route !== "/")
      .sort((a, b) => b.length - a.length)
      .find((route) => pathname.startsWith(`${route}/`));
    return parentRoute ? routeNames[parentRoute] : "AI 工作区";
  }, [pathname]);

  useEffect(() => {
    const updateClock = () => {
      const nextNow = new Date();
      setNow(nextNow);
      setElapsedSeconds(Math.max(0, Math.floor((nextNow.getTime() - startedAt.current) / 1000)));
    };

    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const connection = getConnection();

    const updateNetwork = () => {
      setOnline(navigator.onLine);
      const nextRtt = connection?.rtt;
      setRtt(typeof nextRtt === "number" && Number.isFinite(nextRtt) ? Math.max(0, Math.round(nextRtt)) : null);
      setNetworkType(connection?.effectiveType?.toUpperCase() ?? null);
    };

    updateNetwork();
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    connection?.addEventListener("change", updateNetwork);

    return () => {
      window.removeEventListener("online", updateNetwork);
      window.removeEventListener("offline", updateNetwork);
      connection?.removeEventListener("change", updateNetwork);
    };
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let pulseTimer: number | undefined;

    const syncPulse = () => {
      if (pulseTimer) window.clearInterval(pulseTimer);
      pulseTimer = undefined;

      if (!reducedMotion.matches) {
        pulseTimer = window.setInterval(() => {
          setPulse((levels) => [...levels.slice(1), 2 + Math.floor(Math.random() * 7)]);
        }, 760);
      }
    };

    syncPulse();
    reducedMotion.addEventListener("change", syncPulse);

    return () => {
      if (pulseTimer) window.clearInterval(pulseTimer);
      reducedMotion.removeEventListener("change", syncPulse);
    };
  }, []);

  const timeText = now
    ? new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }).format(now)
    : "--:--:--";

  const dateText = now
    ? new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "long"
      }).format(now)
    : "本地时间同步中";

  const connectionLabel = online === null ? "检测中" : online ? "在线" : "离线";
  const ConnectionIcon = online === false ? WifiOff : Wifi;

  return (
    <aside
      aria-label="工作区实时状态"
      className="relative flex min-h-9 w-full items-center overflow-hidden rounded-md border border-border/70 bg-card/70 px-2.5 text-[10px] text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl sm:px-3"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-0.5 ${online === false ? "bg-rose-500" : "bg-[#2DD4BF]"}`}
      />

      <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3.5">
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`flex shrink-0 items-center gap-1.5 font-semibold ${
            online === false ? "text-rose-500" : "text-[#0F9F8E] dark:text-[#2DD4BF]"
          }`}
          title={`网络状态：${connectionLabel}`}
        >
          <span className="relative flex h-2 w-2" aria-hidden="true">
            {online !== false && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2DD4BF] opacity-55 motion-reduce:animate-none" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${online === false ? "bg-rose-500" : "bg-[#2DD4BF]"}`}
            />
          </span>
          <ConnectionIcon className="h-3 w-3" aria-hidden="true" />
          <span>{connectionLabel}</span>
        </div>

        <span className="h-3 w-px shrink-0 bg-border/80" aria-hidden="true" />

        <time
          className="flex shrink-0 items-center gap-1.5 font-mono tabular-nums text-foreground/80"
          dateTime={now?.toISOString()}
          title={dateText}
        >
          <Clock3 className="h-3 w-3 text-[#5B7CFF]" aria-hidden="true" />
          {timeText}
        </time>

        <span className="h-3 w-px shrink-0 bg-border/80" aria-hidden="true" />

        <div className="flex min-w-0 items-center gap-1.5 text-foreground/75" title={`当前模块：${routeName}`}>
          <MapPin className="h-3 w-3 shrink-0 text-[#2DD4BF]" aria-hidden="true" />
          <span className="max-w-24 truncate sm:max-w-40">{routeName}</span>
        </div>

        <div className="hidden shrink-0 items-center gap-3 sm:flex">
          <span className="h-3 w-px bg-border/80" aria-hidden="true" />
          <span className="flex items-center gap-1.5" title="本次页面会话时长">
            <TimerReset className="h-3 w-3 text-[#5B7CFF]" aria-hidden="true" />
            <span className="text-muted-foreground">SESSION</span>
            <span className="font-mono tabular-nums text-foreground/80">{formatDuration(elapsedSeconds)}</span>
          </span>
          <span className="h-3 w-px bg-border/80" aria-hidden="true" />
          <span className="flex items-center gap-1.5" title="浏览器提供的网络往返时延估值">
            <Gauge className="h-3 w-3 text-[#2DD4BF]" aria-hidden="true" />
            <span className="text-muted-foreground">RTT</span>
            <span className="min-w-10 font-mono tabular-nums text-foreground/80">
              {rtt === null ? "-- ms" : `${rtt} ms`}
            </span>
            {networkType && <span className="hidden text-[#0F9F8E] dark:text-[#2DD4BF] md:inline">{networkType}</span>}
          </span>
        </div>
      </div>

      <div className="ml-3 hidden shrink-0 items-center gap-2 border-l border-border/80 pl-3 lg:flex" aria-hidden="true">
        <Radio className="h-3 w-3 text-[#2DD4BF]" aria-hidden="true" />
        <div className="flex h-4 w-[58px] items-center gap-0.5" aria-hidden="true">
          {pulse.map((level, index) => (
            <span
              key={index}
              className="w-0.5 rounded-sm bg-[#2DD4BF] opacity-75 transition-[height,opacity] duration-500 motion-reduce:transition-none"
              style={{ height: `${level * 1.5}px`, opacity: 0.38 + level * 0.07 }}
            />
          ))}
        </div>
        <Activity className="h-3 w-3 text-[#5B7CFF]" aria-hidden="true" />
        <span className="font-mono text-foreground/70">LIVE</span>
      </div>
    </aside>
  );
}
