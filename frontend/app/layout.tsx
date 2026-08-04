import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { Toaster } from "sonner";

import { BackgroundProvider } from "@/components/background-provider";
import { PwaRegister } from "@/components/pwa-register";
import { Sidebar } from "@/components/sidebar";
import { SiteBackdrop } from "@/components/site-backdrop";
import { SystemAmbient } from "@/components/system-ambient";
import { TelemetryStrip } from "@/components/telemetry-strip";
import { ThemeProvider } from "@/components/theme-provider";
import { Topbar } from "@/components/topbar";
import { TransparencyProvider } from "@/components/transparency-provider";

import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

const backgroundInitScript = `
  try {
    var background = localStorage.getItem("aiweb-background");
    document.documentElement.dataset.background = background === "portrait" ? "portrait" : "classic";
    var savedTheme = localStorage.getItem("theme");
    if (savedTheme !== "light" && savedTheme !== "dark") {
      savedTheme = "dark";
      localStorage.setItem("theme", savedTheme);
    }
    document.documentElement.classList.toggle("dark", savedTheme === "dark");
    var savedTransparencyValue = localStorage.getItem("aiweb-card-transparency");
    var savedTransparency = savedTransparencyValue === null ? Number.NaN : Number(savedTransparencyValue);
    var transparency = Number.isFinite(savedTransparency) ? Math.min(96, Math.max(55, Math.round(savedTransparency))) : 88;
    var opacity = 100 - transparency;
    var rootStyle = document.documentElement.style;
    rootStyle.setProperty("--portrait-glass-opacity", opacity + "%");
    rootStyle.setProperty("--portrait-glass-panel-opacity", Math.min(opacity + 2, 48) + "%");
    rootStyle.setProperty("--portrait-glass-subtle-opacity", Math.max(opacity - 4, 3) + "%");
    rootStyle.setProperty("--portrait-glass-high-opacity", Math.min(opacity + 4, 50) + "%");
    rootStyle.setProperty("--portrait-glass-medium-opacity", Math.max(opacity + 1, 3) + "%");
    rootStyle.setProperty("--portrait-glass-low-opacity", Math.max(opacity - 3, 3) + "%");
    rootStyle.setProperty("--portrait-glass-dark-opacity", Math.min(opacity + 8, 52) + "%");
    rootStyle.setProperty("--portrait-glass-dark-subtle-opacity", Math.max(opacity, 3) + "%");
    rootStyle.setProperty("--portrait-glass-dark-high-opacity", Math.min(opacity + 10, 54) + "%");
    rootStyle.setProperty("--portrait-glass-dark-medium-opacity", Math.min(opacity + 6, 50) + "%");
    rootStyle.setProperty("--portrait-glass-dark-low-opacity", Math.min(opacity + 3, 48) + "%");
  } catch (error) {
    document.documentElement.dataset.background = "portrait";
    document.documentElement.classList.add("dark");
  }
`;

export const metadata: Metadata = {
  title: "AIWeb Studio",
  description: "集 AI 对话、图像创作与智能工作流于一体的创作工作台。",
  applicationName: "AIWeb Studio",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    apple: "/icons/icon-192.png"
  },
  appleWebApp: {
    capable: true,
    title: "AIWeb Studio",
    statusBarStyle: "black-translucent"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <Script id="aiweb-appearance-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: backgroundInitScript }} />
      </head>
      <body className={inter.className}>
        <ThemeProvider>
          <BackgroundProvider>
            <TransparencyProvider>
              <SiteBackdrop />
              <SystemAmbient />
              <PwaRegister />
              <div className="app-shell min-h-screen lg:grid lg:grid-cols-[224px_minmax(0,1fr)]">
                <Sidebar />
                <main className="min-w-0 px-3 pb-5 pt-3 sm:px-4 lg:px-5 lg:py-5 xl:px-7">
                  <Topbar />
                  <div className="mx-auto w-full max-w-[1720px]">
                    <TelemetryStrip />
                    <div className="mt-4">{children}</div>
                  </div>
                </main>
              </div>
              <Toaster richColors position="top-center" />
            </TransparencyProvider>
          </BackgroundProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
