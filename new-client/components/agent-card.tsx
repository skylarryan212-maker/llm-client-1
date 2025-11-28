"use client";

import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

interface AgentCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  href?: string;
  gradient?: string;
  onClick?: () => void;
}

export function AgentCard({
  icon: Icon,
  title,
  description,
  href,
  gradient,
  onClick,
}: AgentCardProps) {
  const handleLinkClick: React.MouseEventHandler<HTMLAnchorElement> = (event) => {
    if (!onClick) return;
    // Let parent code run (routing, etc.) instead of default link navigation
    event.preventDefault();
    onClick();
  };

  return (
    <div className="w-full">
      <div className="group relative h-full overflow-hidden rounded-xl border border-border bg-card p-6 transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10">
        <div
          className={`pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-5 ${
            gradient || "bg-gradient-to-br from-primary to-primary"
          }`}
        />

        <div className="relative flex h-full flex-col gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-6 w-6" />
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>

          <div className="mt-auto">
            {href ? (
              <Button
                type="button"
                variant="ghost"
                className="group/btn inline-flex items-center gap-2 px-0 text-primary hover:bg-transparent"
                asChild
              >
                <Link href={href} onClick={handleLinkClick}>
                  <span>Open Agent</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-1" />
                </Link>
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="group/btn inline-flex items-center gap-2 px-0 text-primary hover:bg-transparent"
                onClick={onClick}
              >
                <span>Open Agent</span>
                <ArrowRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-1" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
