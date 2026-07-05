import * as React from "react";

import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card/82 shadow-soft backdrop-blur-xl transition-all hover:-translate-y-0.5",
        className
      )}
      {...props}
    />
  );
}
