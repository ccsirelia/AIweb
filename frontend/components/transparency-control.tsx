"use client";

import { AnimatePresence, motion } from "framer-motion";
import { SlidersHorizontal } from "lucide-react";
import { type CSSProperties, useState } from "react";

import { useTransparency } from "@/components/transparency-provider";
import { Button } from "@/components/ui/button";

const MIN_TRANSPARENCY = 55;
const MAX_TRANSPARENCY = 96;

export function TransparencyControl() {
  const [isOpen, setIsOpen] = useState(false);
  const { transparency, setTransparency } = useTransparency();
  const progress = ((transparency - MIN_TRANSPARENCY) / (MAX_TRANSPARENCY - MIN_TRANSPARENCY)) * 100;
  const sliderStyle = { "--slider-progress": `${progress}%` } as CSSProperties;

  return (
    <div className="relative">
      <Button
        type="button"
        variant="secondary"
        size="icon"
        onClick={() => setIsOpen((open) => !open)}
        aria-label="调节卡片通透度"
        title="调节卡片通透度"
        aria-expanded={isOpen}
        className={isOpen ? "border-[#5B7CFF]/60 bg-[#5B7CFF]/10 text-[#5B7CFF]" : undefined}
      >
        <SlidersHorizontal className="h-4 w-4" />
      </Button>

      <AnimatePresence>
        {isOpen ? (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="glass-panel absolute right-0 top-full z-40 mt-2 w-64 rounded-2xl p-4 shadow-soft"
          >
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="card-transparency" className="text-sm font-semibold text-foreground">
                卡片通透度
              </label>
              <output className="rounded-lg border border-border bg-background/50 px-2 py-1 text-xs font-semibold tabular-nums text-muted-foreground">
                {transparency}%
              </output>
            </div>
            <input
              id="card-transparency"
              type="range"
              min={MIN_TRANSPARENCY}
              max={MAX_TRANSPARENCY}
              value={transparency}
              onChange={(event) => setTransparency(Number(event.target.value))}
              aria-label="卡片通透度"
              className="transparency-slider mt-5 w-full"
              style={sliderStyle}
            />
            <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
              <span>更实</span>
              <span>更透</span>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
