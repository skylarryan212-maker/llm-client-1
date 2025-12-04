"use client";

import { useEffect, useState } from "react";

export function usePersistentSidebarOpen(defaultValue = true) {
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return defaultValue;
    try {
      const stored = localStorage.getItem("sidebarOpen");
      if (stored !== null) {
        return stored === "true";
      }
    } catch {
      // Ignore storage access issues and fall back to computed defaults
    }
    // No stored preference yet – default to open on desktop widths, closed on mobile/tablet
    const prefersDesktop = window.matchMedia("(min-width: 1024px)").matches;
    return prefersDesktop ? true : false;
  });

  useEffect(() => {
    localStorage.setItem("sidebarOpen", isOpen ? "true" : "false");
  }, [isOpen]);

  return [isOpen, setIsOpen] as const;
}
