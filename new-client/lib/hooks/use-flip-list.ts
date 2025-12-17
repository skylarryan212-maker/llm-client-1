"use client";

import { RefObject, useLayoutEffect, useRef } from "react";

type RectMap = Map<string, DOMRect>;

function getRectMap(container: HTMLElement, selector: string): RectMap {
  const map: RectMap = new Map();
  const nodes = container.querySelectorAll<HTMLElement>(selector);
  nodes.forEach((node) => {
    const id = node.dataset.flipId;
    if (!id) return;
    map.set(id, node.getBoundingClientRect());
  });
  return map;
}

export function useFlipListAnimation({
  containerRef,
  ids,
  enabled = true,
  durationMs = 260,
  selector = "[data-flip-id]",
}: {
  containerRef: RefObject<HTMLElement | null>;
  ids: readonly string[];
  enabled?: boolean;
  durationMs?: number;
  selector?: string;
}) {
  const prevRectsRef = useRef<RectMap>(new Map());
  const prevIdsRef = useRef<readonly string[]>([]);
  const hasMeasuredRef = useRef(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const nextRects = getRectMap(container, selector);
    const prevRects = prevRectsRef.current;
    const prevIds = prevIdsRef.current;

    // Avoid "flash" animations on first mount / route transitions when the list remounts.
    if (!hasMeasuredRef.current) {
      hasMeasuredRef.current = true;
      prevRectsRef.current = nextRects;
      prevIdsRef.current = ids;
      return;
    }

    if (!enabled || prefersReducedMotion) {
      prevRectsRef.current = nextRects;
      prevIdsRef.current = ids;
      return;
    }

    // Animate moves
    ids.forEach((id) => {
      const prev = prevRects.get(id);
      const next = nextRects.get(id);
      if (!prev || !next) return;

      const deltaX = prev.left - next.left;
      const deltaY = prev.top - next.top;
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;

      const node = container.querySelector<HTMLElement>(`${selector}[data-flip-id="${CSS.escape(id)}"]`);
      if (!node) return;

      node.animate(
        [
          { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
          { transform: "translate3d(0, 0, 0)" },
        ],
        {
          duration: durationMs,
          easing: "cubic-bezier(0.2, 1, 0.2, 1)",
        }
      );
    });

    // Animate inserts (items that were not present before)
    ids.forEach((id) => {
      if (prevRects.has(id)) return;
      const node = container.querySelector<HTMLElement>(`${selector}[data-flip-id="${CSS.escape(id)}"]`);
      if (!node) return;
      node.animate(
        [
          { opacity: 0, transform: "translate3d(0, 6px, 0)" },
          { opacity: 1, transform: "translate3d(0, 0, 0)" },
        ],
        { duration: Math.max(160, Math.floor(durationMs * 0.8)), easing: "ease-out" }
      );
    });

    // If the list identity changes drastically (e.g. filter toggle), avoid animating stale layout next time.
    const prevSet = new Set(prevIds);
    const overlap = ids.filter((id) => prevSet.has(id)).length;
    if (prevIds.length && overlap / prevIds.length < 0.35) {
      prevRectsRef.current = nextRects;
      prevIdsRef.current = ids;
      return;
    }

    prevRectsRef.current = nextRects;
    prevIdsRef.current = ids;
  }, [containerRef, durationMs, enabled, ids, selector]);
}
