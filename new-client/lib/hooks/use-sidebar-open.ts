"use client";

import { useEffect, useLayoutEffect, useState } from "react";

export function usePersistentSidebarOpen(defaultValue = true) {
  const [isOpen, setIsOpen] = useState<boolean>(defaultValue);

  useLayoutEffect(() => {
    const stored = localStorage.getItem("sidebarOpen");
    if (stored !== null) {
      setIsOpen(stored === "true");
    } else {
      setIsOpen(defaultValue);
    }
  }, [defaultValue]);

  useEffect(() => {
    localStorage.setItem("sidebarOpen", isOpen ? "true" : "false");
  }, [isOpen]);

  return [isOpen, setIsOpen] as const;
}
