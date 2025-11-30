"use server";

import { revalidatePath } from "next/cache";
import { createProject, deleteProject, renameProject } from "@/lib/data/projects";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/supabase/user";

export async function createProjectAction(name: string, icon?: string, color?: string) {
  const project = await createProject({ name, icon, color });
  return project;
}

export async function updateProjectIconAction(projectId: string, icon: string, color: string) {
  const supabase = await supabaseServer();
  const userId = getCurrentUserId();

  const { data, error } = await (supabase
    .from("projects") as any)
    .update({ icon, color })
    .eq("id", projectId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to update project icon: ${error?.message ?? "Unknown error"}`);
  }

  revalidatePath("/");
  revalidatePath("/projects");
  revalidatePath("/projects/[projectId]", "page");
  
  return data;
}

export async function renameProjectAction(projectId: string, name: string) {
  const updated = await renameProject({ projectId, name });
  revalidatePath("/");
  revalidatePath("/projects");
  revalidatePath("/projects/[projectId]", "page");
  return updated;
}

export async function deleteProjectAction(projectId: string) {
  await deleteProject(projectId);
  revalidatePath("/");
  revalidatePath("/projects");
  revalidatePath("/projects/[projectId]", "page");
}
