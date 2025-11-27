"use client";

import { useEffect, useState } from "react";

export function usePersistentSidebarOpen(defaultValue = true) {
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return defaultValue;
    const stored = localStorage.getItem("sidebarOpen");
    return stored !== null ? stored === "true" : defaultValue;
  });

  useEffect(() => {
    localStorage.setItem("sidebarOpen", isOpen ? "true" : "false");
  }, [isOpen]);

  return [isOpen, setIsOpen] as const;
}
