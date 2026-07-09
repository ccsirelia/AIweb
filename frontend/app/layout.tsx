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
          <div className="min-h-screen lg:grid lg:grid-cols-[272px_1fr]">
            <Sidebar />
            <main className="min-w-0 px-4 pb-8 pt-4 sm:px-6 lg:px-8">
              <div className="mx-auto flex max-w-7xl items-center justify-between pb-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    AIWeb Studio
                  </p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-normal text-foreground">
                    Creation Console
                  </h1>
                </div>
                <div className="flex items-center gap-3">
                  <ThemeToggle />
                  <UserAccountButton />
                </div>
              </div>
              <div className="mx-auto max-w-7xl">{children}</div>
            </main>
          </div>
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
