"use server";

import { createProject, deleteProject, renameProject } from "@/lib/data/projects";

export async function createProjectAction(name: string) {
  const project = await createProject({ name });
  return project;
}

export async function renameProjectAction(projectId: string, name: string) {
  const updated = await renameProject({ projectId, name });
  return updated;
}

export async function deleteProjectAction(projectId: string) {
  await deleteProject(projectId);
}
