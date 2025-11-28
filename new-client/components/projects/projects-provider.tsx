"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { createProjectAction } from "@/app/actions/project-actions";

export type ProjectSummary = {
  id: string;
  name: string;
  createdAt: string;
  icon?: string;
  description?: string;
};

type ProjectsContextValue = {
  projects: ProjectSummary[];
  addProject: (name: string) => Promise<ProjectSummary>;
};

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

const initialProjects: ProjectSummary[] = [];

export function ProjectsProvider({
  children,
  initialProjects: initialProjectsProp = initialProjects,
}: {
  children: React.ReactNode;
  initialProjects?: ProjectSummary[];
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>(initialProjectsProp);

  const addProject = useCallback(async (name: string): Promise<ProjectSummary> => {
    const created = await createProjectAction(name);

    const newProject: ProjectSummary = {
      id: created.id,
      name: created.name,
      createdAt: created.created_at ?? new Date().toISOString(),
      icon: "🧭",
      description: "Newly created project",
    };

    setProjects((prev) => [newProject, ...prev]);
    return newProject;
  }, []);

  const value = useMemo(
    () => ({
      projects,
      addProject,
    }),
    [addProject, projects]
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
