"use client";

import React, { startTransition } from "react";
import Link, { type LinkProps } from "next/link";
import { useRouter } from "next/navigation";

type Props = LinkProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  };

function shouldInterceptClick(event: React.MouseEvent<HTMLAnchorElement>) {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey
  );
}

export function ViewTransitionLink({ href, onClick, ...props }: Props) {
  const router = useRouter();

  const handleClick: React.MouseEventHandler<HTMLAnchorElement> = (event) => {
    onClick?.(event);
    if (!shouldInterceptClick(event)) return;

    // Let the browser handle if it should open a new tab/window.
    if ((event.currentTarget as HTMLAnchorElement).target) return;

    // Use View Transitions API if available and motion is allowed.
    const canAnimate =
      typeof document !== "undefined" &&
      typeof (document as any).startViewTransition === "function" &&
      typeof window !== "undefined" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    event.preventDefault();

    const navigate = () => {
      router.push(typeof href === "string" ? href : href.pathname ?? "/");
    };

    if (!canAnimate) {
      navigate();
      return;
    }

    (document as any).startViewTransition(() => {
      startTransition(() => navigate());
    });
  };

  return <Link href={href} onClick={handleClick} {...props} />;
}

