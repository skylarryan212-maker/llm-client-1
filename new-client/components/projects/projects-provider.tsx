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
  color?: string;
  description?: string;
};

type ProjectsContextValue = {
  projects: ProjectSummary[];
  addProject: (name: string, icon?: string, color?: string) => Promise<ProjectSummary>;
  refreshProjects: () => Promise<void>;
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
  const userId = getCurrentUserId();

  const refreshProjects = useCallback(async () => {
    try {
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
        icon: r.icon ?? "file",
        color: r.color ?? "white",
        description: r.description ?? "",
      } as ProjectSummary));

      setProjects(mapped);
    } catch (err) {
      console.warn("projects-provider refresh error", err);
    }
  }, [userId]);

  // Hydrate on mount
  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  // Realtime updates for projects table (INSERT/UPDATE/DELETE)
  useEffect(() => {
    if (!userId) return;
    const channel = supabaseClient
      .channel("public:projects")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects", filter: `user_id=eq.${userId}` },
        (payload) => {
          const newRow = payload.new as any | null;
          const oldRow = payload.old as any | null;

          if (payload.eventType === "INSERT" && newRow) {
            setProjects((prev) => [
              {
                id: newRow.id,
                name: newRow.name,
                createdAt: newRow.created_at ?? new Date().toISOString(),
                icon: newRow.icon ?? "file",
                color: newRow.color ?? "white",
                description: newRow.description ?? "",
              },
              ...prev.filter((p) => p.id !== newRow.id),
            ]);
            return;
          }

          if (payload.eventType === "UPDATE" && newRow) {
            setProjects((prev) =>
              prev.map((p) =>
                p.id === newRow.id
                  ? {
                      id: newRow.id,
                      name: newRow.name,
                      createdAt: newRow.created_at ?? p.createdAt,
                      icon: newRow.icon ?? p.icon,
                      color: newRow.color ?? p.color,
                      description: newRow.description ?? p.description,
                    }
                  : p
              )
            );
            return;
          }

          if (payload.eventType === "DELETE" && oldRow) {
            setProjects((prev) => prev.filter((p) => p.id !== oldRow.id));
            return;
          }
        }
      )
      .subscribe();

    return () => {
      try { channel.unsubscribe(); } catch {}
    };
  }, [userId]);

  // Refresh on tab focus/visibility gain to recover from missed events
  useEffect(() => {
    const onFocus = () => refreshProjects();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshProjects();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshProjects]);

  const addProject = useCallback(async (name: string, icon?: string, color?: string): Promise<ProjectSummary> => {
    const created = await createProjectAction(name, icon, color);

    const newProject: ProjectSummary = {
      id: created.id,
      name: created.name,
      createdAt: created.created_at ?? new Date().toISOString(),
      icon: created.icon ?? icon ?? "file",
      color: created.color ?? color ?? "white",
      description: "Newly created project",
    };

    setProjects((prev) => [newProject, ...prev]);
    return newProject;
  }, []);

  const value = useMemo(
    () => ({
      projects,
      addProject,
      refreshProjects,
    }),
    [addProject, projects, refreshProjects]
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
