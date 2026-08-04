"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Clock3,
  FolderKanban,
  Gauge,
  ImageIcon,
  LayoutDashboard,
  MessageSquareText,
  Search,
  Settings,
  UserRound,
  Workflow,
  X
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

const destinations = [
  { href: "/", label: "控制台", description: "查看创作概览", icon: LayoutDashboard, accent: "text-[#5B7CFF]" },
  { href: "/chat", label: "AI 对话", description: "写作、分析与代码", icon: MessageSquareText, accent: "text-[#2DD4BF]" },
  { href: "/image", label: "视觉工坊", description: "文生图与图生图", icon: ImageIcon, accent: "text-[#FB7185]" },
  { href: "/workflows", label: "工作流实验室", description: "编排聊天与生图模板", icon: Workflow, accent: "text-[#A78BFA]" },
  { href: "/runs", label: "执行控制台", description: "运行、调试与定时工作流", icon: Gauge, accent: "text-[#38BDF8]" },
  { href: "/studio", label: "创作中枢", description: "项目、Artifact、品牌与评测", icon: FolderKanban, accent: "text-[#34D399]" },
  { href: "/history", label: "创作档案", description: "回看对话与作品", icon: Clock3, accent: "text-[#FBBF24]" },
  { href: "/account", label: "账户中心", description: "用量与个人信息", icon: UserRound, accent: "text-[#A78BFA]" },
  { href: "/settings", label: "偏好设置", description: "主题、背景与透明度", icon: Settings, accent: "text-[#94A3B8]" }
];

export function CommandMenu() {
  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => {
          if (!value) {
            previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }
          return !value;
        });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;

    setQuery("");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => inputRef.current?.focus());

    function onDialogKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }

      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (!dialog.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus();
      } else if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", onDialogKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onDialogKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return destinations;
    return destinations.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(normalized));
  }, [query]);

  function navigate(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        onClick={() => {
          previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setOpen(true);
        }}
        aria-label="打开快捷导航"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="aiweb-command-menu"
        title="快捷导航"
      >
        <Search className="h-4 w-4" />
      </Button>

      <AnimatePresence>
        {open ? (
          <motion.div
            className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 px-4 pt-[14vh] backdrop-blur-sm"
            initial={shouldReduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : undefined}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <motion.div
              ref={dialogRef}
              id="aiweb-command-menu"
              role="dialog"
              aria-modal="true"
              aria-label="快捷导航"
              tabIndex={-1}
              initial={shouldReduceMotion ? false : { opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={shouldReduceMotion ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: -8, scale: 0.98 }}
              transition={shouldReduceMotion ? { duration: 0 } : undefined}
              className="command-menu w-full max-w-xl overflow-hidden rounded-lg border border-white/10 bg-[#101218]/95 shadow-2xl shadow-black/50"
            >
              <div className="flex items-center gap-3 border-b border-white/10 px-4">
                <Search className="h-4 w-4 text-[#2DD4BF]" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="搜索工作区"
                  placeholder="搜索工作区"
                  className="h-14 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
                />
                <button type="button" onClick={() => setOpen(false)} aria-label="关闭快捷导航" className="grid h-8 w-8 place-items-center rounded-md text-white/50 hover:bg-white/10 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid gap-1 p-2">
                {results.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.href}
                      type="button"
                      onClick={() => navigate(item.href)}
                      className="group flex min-h-14 items-center gap-3 rounded-md px-3 text-left transition hover:bg-white/[0.07]"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.04]">
                        <Icon className={`h-4 w-4 ${item.accent}`} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-white">{item.label}</span>
                        <span className="block truncate text-xs text-white/40">{item.description}</span>
                      </span>
                    </button>
                  );
                })}
                {results.length === 0 ? <div className="px-3 py-10 text-center text-sm text-white/40">没有匹配的工作区</div> : null}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
