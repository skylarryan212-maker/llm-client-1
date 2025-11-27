"use client";

import { createContext, useContext, useMemo, useState } from "react";

export type ProjectSummary = {
  id: string;
  name: string;
  createdAt: string;
  icon?: string;
  description?: string;
};

type ProjectsContextValue = {
  projects: ProjectSummary[];
  addProject: (name: string) => ProjectSummary;
};

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

const initialProjects: ProjectSummary[] = [
  {
    id: "proj-1",
    name: "Demo Project",
    createdAt: "2025-01-01",
    icon: "🚀",
    description: "Starter playground for LLM workflows.",
  },
  {
    id: "proj-2",
    name: "Marketing Launch Kit",
    createdAt: "2025-02-14",
    icon: "📣",
    description: "Assets and prompts for the spring product launch.",
  },
  {
    id: "proj-3",
    name: "Docs Migration",
    createdAt: "2025-03-05",
    icon: "📚",
    description: "Move legacy docs into the new knowledge base.",
  },
];

export function ProjectsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>(initialProjects);

  const addProject = (name: string): ProjectSummary => {
    const newProject: ProjectSummary = {
      id: `proj-${Date.now()}`,
      name,
      createdAt: new Date().toISOString().slice(0, 10),
      icon: "🧭",
      description: "Newly created project",
    };

    setProjects((prev) => [newProject, ...prev]);
    return newProject;
  };

  const value = useMemo(
    () => ({
      projects,
      addProject,
    }),
    [projects]
  );

  return (
    <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>
  );
}

export function useProjects() {
  const context = useContext(ProjectsContext);
  if (!context) {
    throw new Error("useProjects must be used within a ProjectsProvider");
  }
  return context;
}
