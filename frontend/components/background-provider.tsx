"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type BackgroundStyle = "classic" | "portrait";

type BackgroundContextValue = {
  background: BackgroundStyle;
  setBackground: (background: BackgroundStyle) => void;
  toggleBackground: () => void;
};

const STORAGE_KEY = "aiweb-background";
const BackgroundContext = createContext<BackgroundContextValue | null>(null);

function applyBackground(background: BackgroundStyle) {
  document.documentElement.dataset.background = background;
  window.localStorage.setItem(STORAGE_KEY, background);
}

export function BackgroundProvider({ children }: { children: React.ReactNode }) {
  const [background, setBackgroundState] = useState<BackgroundStyle>("portrait");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const initialBackground: BackgroundStyle = stored === "classic" ? "classic" : "portrait";

    setBackgroundState(initialBackground);
    document.documentElement.dataset.background = initialBackground;
  }, []);

  function setBackground(backgroundStyle: BackgroundStyle) {
    setBackgroundState(backgroundStyle);
    applyBackground(backgroundStyle);
  }

  function toggleBackground() {
    setBackground(background === "portrait" ? "classic" : "portrait");
  }

  const value = useMemo(
    () => ({ background, setBackground, toggleBackground }),
    [background]
  );

  return <BackgroundContext.Provider value={value}>{children}</BackgroundContext.Provider>;
}

export function useBackground() {
  const context = useContext(BackgroundContext);

  if (!context) {
    throw new Error("useBackground must be used within BackgroundProvider");
  }

  return context;
}
