"use client";

import Link from "next/link";
import { CalendarIcon } from "lucide-react";

import { ProjectSummary } from "@/components/projects/projects-provider";

interface ProjectCardProps {
  project: ProjectSummary;
}

export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className="group block rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden>
            {project.icon ?? "📁"}
          </span>
          <div>
            <h3 className="text-lg font-semibold text-foreground group-hover:text-primary">
              {project.name}
            </h3>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {project.description || "Project description coming soon."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarIcon className="h-4 w-4" />
          <span>{project.createdAt}</span>
        </div>
      </div>
    </Link>
  );
}
