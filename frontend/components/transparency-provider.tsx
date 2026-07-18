"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type TransparencyContextValue = {
  transparency: number;
  setTransparency: (value: number) => void;
};

const STORAGE_KEY = "aiweb-card-transparency";
const DEFAULT_TRANSPARENCY = 88;
const MIN_TRANSPARENCY = 55;
const MAX_TRANSPARENCY = 96;
const TransparencyContext = createContext<TransparencyContextValue | null>(null);

function clampTransparency(value: number) {
  return Math.min(MAX_TRANSPARENCY, Math.max(MIN_TRANSPARENCY, Math.round(value)));
}

function setOpacityVariable(name: string, value: number) {
  document.documentElement.style.setProperty(name, `${Math.round(value)}%`);
}

function applyTransparency(value: number) {
  const transparency = clampTransparency(value);
  const opacity = 100 - transparency;

  setOpacityVariable("--portrait-glass-opacity", opacity);
  setOpacityVariable("--portrait-glass-panel-opacity", Math.min(opacity + 2, 48));
  setOpacityVariable("--portrait-glass-subtle-opacity", Math.max(opacity - 4, 3));
  setOpacityVariable("--portrait-glass-high-opacity", Math.min(opacity + 4, 50));
  setOpacityVariable("--portrait-glass-medium-opacity", Math.max(opacity + 1, 3));
  setOpacityVariable("--portrait-glass-low-opacity", Math.max(opacity - 3, 3));

  setOpacityVariable("--portrait-glass-dark-opacity", Math.min(opacity + 8, 52));
  setOpacityVariable("--portrait-glass-dark-subtle-opacity", Math.max(opacity, 3));
  setOpacityVariable("--portrait-glass-dark-high-opacity", Math.min(opacity + 10, 54));
  setOpacityVariable("--portrait-glass-dark-medium-opacity", Math.min(opacity + 6, 50));
  setOpacityVariable("--portrait-glass-dark-low-opacity", Math.min(opacity + 3, 48));
}

export function TransparencyProvider({ children }: { children: React.ReactNode }) {
  const [transparency, setTransparencyState] = useState(DEFAULT_TRANSPARENCY);

  useEffect(() => {
    const storedValue = window.localStorage.getItem(STORAGE_KEY);
    const stored = storedValue === null ? Number.NaN : Number(storedValue);
    const initialTransparency = Number.isFinite(stored)
      ? clampTransparency(stored)
      : DEFAULT_TRANSPARENCY;

    setTransparencyState(initialTransparency);
    applyTransparency(initialTransparency);
  }, []);

  function setTransparency(value: number) {
    const nextTransparency = clampTransparency(value);
    setTransparencyState(nextTransparency);
    applyTransparency(nextTransparency);
    window.localStorage.setItem(STORAGE_KEY, String(nextTransparency));
  }

  const value = useMemo(
    () => ({ transparency, setTransparency }),
    [transparency]
  );

  return <TransparencyContext.Provider value={value}>{children}</TransparencyContext.Provider>;
}

export function useTransparency() {
  const context = useContext(TransparencyContext);

  if (!context) {
    throw new Error("useTransparency must be used within TransparencyProvider");
  }

  return context;
}
