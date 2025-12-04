"use client";

import { useEffect, useLayoutEffect, useState } from "react";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function usePersistentSidebarOpen(defaultValue = true) {
  const [isOpen, setIsOpen] = useState<boolean>(defaultValue);

  useIsomorphicLayoutEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const stored = localStorage.getItem("sidebarOpen");
      if (stored !== null) {
        setIsOpen(stored === "true");
        return;
      }
    } catch {
      // Ignore storage access issues and fall back to computed defaults
    }

    const prefersDesktop = window.matchMedia("(min-width: 1024px)").matches;
    setIsOpen(prefersDesktop);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem("sidebarOpen", isOpen ? "true" : "false");
    } catch {
      // Ignore storage write errors (e.g., private browsing)
    }
  }, [isOpen]);

  return [isOpen, setIsOpen] as const;
}
