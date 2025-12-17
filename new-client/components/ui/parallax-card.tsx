"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type ParallaxCardProps = {
  className?: string;
  children: React.ReactNode;
  glint?: boolean;
  style?: React.CSSProperties;
};

export function ParallaxCard({
  className,
  children,
  glint = true,
  style,
}: ParallaxCardProps) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const frameRef = React.useRef<number | null>(null);
  const reducedMotionRef = React.useRef(false);
  const [isHover, setIsHover] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      reducedMotionRef.current = mq.matches;
    };
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  const setVars = React.useCallback(
    (mx: string, my: string) => {
      const el = ref.current;
      if (!el) return;
      el.style.setProperty("--mx", mx);
      el.style.setProperty("--my", my);
    },
    []
  );

  const handlePointerMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (reducedMotionRef.current) return;
    const el = ref.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const nextMx = `${(clamp01(x) * 100).toFixed(2)}%`;
    const nextMy = `${(clamp01(y) * 100).toFixed(2)}%`;

    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = requestAnimationFrame(() => {
      setVars(nextMx, nextMy);
      frameRef.current = null;
    });
  };

  const handlePointerEnter: React.PointerEventHandler<HTMLDivElement> = () => {
    if (reducedMotionRef.current) return;
    setIsHover(true);
  };

  const handlePointerLeave: React.PointerEventHandler<HTMLDivElement> = () => {
    if (reducedMotionRef.current) return;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    setIsHover(false);
    setVars("50%", "50%");
  };

  return (
    <div
      ref={ref}
      className={cn("parallax-card", className)}
      style={style}
      data-hover={isHover ? "true" : "false"}
      onPointerEnter={handlePointerEnter}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {children}
      {glint ? <div className="parallax-glint" aria-hidden="true" /> : null}
    </div>
  );
}
