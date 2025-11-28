"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createProjectAction } from "@/app/actions/project-actions";
import supabaseClient from "@/lib/supabase/client";
import { getCurrentUserId } from "@/lib/supabase/user";

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

  // Fetch projects on client mount to ensure the provider is hydrated when
  // the page is opened directly or manually reloaded.
  useEffect(() => {
    const hydrate = async () => {
      try {
        const userId = getCurrentUserId();
        if (!userId) return;
        const { data, error } = await supabaseClient
          .from("projects")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        if (error) {
          console.warn("Failed to load projects (client):", error);
          return;
        }

        const rows = data ?? [];
        const mapped = rows.map((r: any) => ({
          id: r.id,
          name: r.name,
          createdAt: r.created_at ?? new Date().toISOString(),
          icon: r.icon ?? "🧭",
          description: r.description ?? "",
        } as ProjectSummary));

        setProjects(mapped);
      } catch (err) {
        console.warn("projects-provider hydrate error", err);
      }
    };

    hydrate();
  }, []);

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
