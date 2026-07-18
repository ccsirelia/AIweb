"use client";

import { ImageIcon, PanelsTopLeft } from "lucide-react";

import { useBackground } from "@/components/background-provider";
import { Button } from "@/components/ui/button";

export function BackgroundToggle() {
  const { background, toggleBackground } = useBackground();
  const portraitEnabled = background === "portrait";
  const label = portraitEnabled ? "切换为经典背景" : "切换为人物背景";

  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      onClick={toggleBackground}
      aria-label={label}
      title={label}
      aria-pressed={portraitEnabled}
      className="relative overflow-hidden"
    >
      <ImageIcon
        className={`absolute h-4 w-4 transition-all duration-300 ${
          portraitEnabled ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0"
        }`}
      />
      <PanelsTopLeft
        className={`absolute h-4 w-4 transition-all duration-300 ${
          portraitEnabled ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
        }`}
      />
      <span
        className={`absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-[#F28CA5] transition-opacity ${
          portraitEnabled ? "opacity-100" : "opacity-0"
        }`}
      />
    </Button>
  );
}
