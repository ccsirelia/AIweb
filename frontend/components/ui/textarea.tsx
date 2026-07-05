import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      "min-h-[120px] w-full resize-none rounded-2xl border border-border bg-white/80 px-4 py-3 text-sm text-foreground shadow-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-blue-500/10 dark:bg-white/[0.04]",
      className
    )}
    ref={ref}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export { Textarea };
