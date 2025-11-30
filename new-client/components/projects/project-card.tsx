"use client";

import Link from "next/link";
import { CalendarIcon } from "lucide-react";

import { ProjectSummary } from "@/components/projects/projects-provider";
import { ProjectIconEditor } from "@/components/project-icon-editor";
import { updateProjectIconAction } from "@/app/actions/project-actions";

interface ProjectCardProps {
  project: ProjectSummary;
  onUpdate?: () => void;
}

const formatRelativeTime = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
};

export function ProjectCard({ project, onUpdate }: ProjectCardProps) {
  const handleIconUpdate = async (icon: string, color: string) => {
    await updateProjectIconAction(project.id, icon, color);
    onUpdate?.();
  };

  const formattedDate = formatRelativeTime(project.createdAt);

  return (
    <div className="group relative rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5">
      <Link href={`/projects/${project.id}`} className="block">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center">
              {/* Placeholder for icon position */}
            </div>
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
          <span>{formattedDate}</span>
        </div>
      </div>
      </Link>
      
      <div 
        className="absolute left-5 z-10 flex items-center justify-center"
        style={{ top: '50%', transform: 'translateY(-50%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <ProjectIconEditor
          icon={project.icon || 'file'}
          color={project.color || 'white'}
          onSave={handleIconUpdate}
          size="lg"
        />
      </div>
    </div>
  );
}
