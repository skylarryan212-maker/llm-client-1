"use client";

import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AgentCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  gradient?: string;
}

export function AgentCard({ icon: Icon, title, description, href, gradient }: AgentCardProps) {
  return (
    <Link href={href} className="block">
      <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-6 transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10">
        <div className={`absolute inset-0 opacity-0 transition-opacity group-hover:opacity-5 ${gradient || 'bg-gradient-to-br from-primary to-primary'}`} />

        <div className="relative space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-6 w-6" />
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
          </div>

          <Button variant="ghost" className="group/btn gap-2 px-0 text-primary hover:bg-transparent hover:text-primary">
            Open Agent
            <ArrowRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-1" />
          </Button>
        </div>
      </div>
    </Link>
  );
}
