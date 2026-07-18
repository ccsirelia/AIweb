import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";

import { BackgroundProvider } from "@/components/background-provider";
import { BackgroundToggle } from "@/components/background-toggle";
import { Sidebar } from "@/components/sidebar";
import { SiteBackdrop } from "@/components/site-backdrop";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { TransparencyControl } from "@/components/transparency-control";
import { TransparencyProvider } from "@/components/transparency-provider";
import { UserAccountButton } from "@/components/user-account-button";

import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

const backgroundInitScript = `
  try {
    var background = localStorage.getItem("aiweb-background");
    document.documentElement.dataset.background = background === "classic" ? "classic" : "portrait";
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
  description: "A premium AI writing and image creation workspace."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: backgroundInitScript }} />
      </head>
      <body className={inter.className}>
        <ThemeProvider>
          <BackgroundProvider>
            <TransparencyProvider>
              <SiteBackdrop />
              <div className="app-shell min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
                <Sidebar />
                <main className="min-w-0 px-3 pb-5 pt-3 sm:px-4 lg:px-5 xl:px-6">
                  <div className="mx-auto flex w-full max-w-[1680px] items-center justify-between pb-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        AIWeb Studio
                      </p>
                      <h1 className="mt-0.5 text-xl font-semibold tracking-normal text-foreground sm:text-2xl">
                        Creation Console
                      </h1>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3">
                      <TransparencyControl />
                      <BackgroundToggle />
                      <ThemeToggle />
                      <UserAccountButton />
                    </div>
                  </div>
                  <div className="mx-auto w-full max-w-[1680px]">{children}</div>
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
