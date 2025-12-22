"use client";

import { useEffect, useLayoutEffect, useState } from "react";

const MOBILE_BREAKPOINT = "(min-width: 1024px)";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

function computeInitial(defaultValue: boolean): boolean {
  if (typeof window === "undefined") {
    return defaultValue;
  }

  const isDesktop = window.matchMedia(MOBILE_BREAKPOINT).matches;
  if (!isDesktop) {
    return false;
  }

  try {
    const stored = localStorage.getItem("sidebarOpen");
    if (stored !== null) {
      return stored === "true";
    }
  } catch {
    // ignore
  }
  return defaultValue;
}

export function usePersistentSidebarOpen(defaultValue = true) {
  const [isOpen, setIsOpen] = useState<boolean>(defaultValue);

  useIsomorphicLayoutEffect(() => {
    const updateState = () => {
      setIsOpen(computeInitial(defaultValue));
    };

    updateState();

    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT);

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", updateState);
    } else {
      mediaQuery.addListener(updateState);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", updateState);
      } else {
        mediaQuery.removeListener(updateState);
      }
    };
  }, [defaultValue]);

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
