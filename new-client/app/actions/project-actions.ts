"use server";

import { createProject } from "@/lib/data/projects";

export async function createProjectAction(name: string) {
  const project = await createProject({ name });
  return project;
}
