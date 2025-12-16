"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function RouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [animate, setAnimate] = useState(true);

  useEffect(() => {
    setAnimate(false);
    const id =
      typeof requestAnimationFrame !== "undefined"
        ? requestAnimationFrame(() => setAnimate(true))
        : (setTimeout(() => setAnimate(true), 0) as unknown as number);
    return () => {
      if (typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(id);
      } else {
        clearTimeout(id);
      }
    };
  }, [pathname]);

  return (
    <div
      data-route={pathname}
      className={animate ? "route-enter-animate" : undefined}
    >
      {children}
    </div>
  );
}
