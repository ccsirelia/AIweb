"use client";

import { useEffect } from "react";
import { toast } from "sonner";

const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister()))
      );
      if ("caches" in window) {
        void window.caches.keys().then((keys) =>
          Promise.all(keys.filter((key) => key.startsWith("aiweb-pwa-")).map((key) => window.caches.delete(key)))
        );
      }
      return;
    }

    let registration: ServiceWorkerRegistration | undefined;
    let lastUpdateCheck = 0;

    const checkForUpdate = () => {
      if (!registration || !navigator.onLine || document.visibilityState !== "visible") {
        return;
      }

      const now = Date.now();
      if (now - lastUpdateCheck < UPDATE_INTERVAL_MS) {
        return;
      }

      lastUpdateCheck = now;
      void registration.update().catch(() => undefined);
    };

    const handleVisibilityChange = () => checkForUpdate();
    const handleOnline = () => checkForUpdate();
    const handleUpdateReady = () => {
      toast("AIWeb 新版本已就绪", {
        description: "刷新后即可使用最新功能。",
        action: {
          label: "刷新",
          onClick: () => window.location.reload()
        }
      });
    };

    window.addEventListener("aiweb:pwa-update-ready", handleUpdateReady);

    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((nextRegistration) => {
        registration = nextRegistration;
        lastUpdateCheck = Date.now();

        nextRegistration.addEventListener("updatefound", () => {
          const worker = nextRegistration.installing;
          if (!worker) return;

          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent("aiweb:pwa-update-ready"));
            }
          });
        });
      })
      .catch(() => undefined);

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("aiweb:pwa-update-ready", handleUpdateReady);
    };
  }, []);

  return null;
}
