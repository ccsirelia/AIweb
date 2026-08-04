import * as React from "react";

import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "glass-card rounded-lg border shadow-soft backdrop-blur-2xl",
        className
      )}
      {...props}
    />
  );
}
