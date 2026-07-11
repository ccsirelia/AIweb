import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";

import { Sidebar } from "@/components/sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserAccountButton } from "@/components/user-account-button";

import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AIWeb Studio",
  description: "A premium AI writing and image creation workspace."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider>
          <div className="min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
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
                  <ThemeToggle />
                  <UserAccountButton />
                </div>
              </div>
              <div className="mx-auto w-full max-w-[1680px]">{children}</div>
            </main>
          </div>
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
