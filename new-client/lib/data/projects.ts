import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/supabase/user";
import type { Database } from "@/lib/supabase/types";

type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
type ProjectInsert = Database["public"]["Tables"]["projects"]["Insert"];

export async function getProjectsForUser() {
  const supabase = await supabaseServer();
  const userId = getCurrentUserId();

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .returns<ProjectRow[]>();

  if (error) {
    throw new Error(`Failed to load projects: ${error.message}`);
  }

  return data ?? [];
}

export async function createProject(params: { name: string; icon?: string; color?: string }) {
  const supabase = await supabaseServer();
  const userId = getCurrentUserId();

  const newProject: ProjectInsert = {
    user_id: userId,
    name: params.name,
    icon: params.icon,
    color: params.color,
  };

  const { data, error } = await (supabase
    .from("projects")
    .insert([newProject] as any))
    .select()
    .single<ProjectRow>();

  if (error || !data) {
    throw new Error(
      `Failed to create project: ${error?.message ?? "Unknown error"}`
    );
  }

  return data;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string | null | undefined) {
  return typeof value === "string" && uuidPattern.test(value);
}

export async function renameProject(params: { projectId: string; name: string }) {
  if (!isValidUuid(params.projectId)) {
    throw new Error("Invalid project ID");
  }

  const supabase = await supabaseServer();
  const userId = getCurrentUserId();

  const { data, error } = await (supabase
    .from("projects") as any)
    .update({ name: params.name })
    .eq("id", params.projectId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to rename project: ${error?.message ?? "Unknown error"}`);
  }

  return data;
}

export async function deleteProject(projectId: string) {
  if (!isValidUuid(projectId)) {
    throw new Error("Invalid project ID");
  }

  const supabase = await supabaseServer();
  const userId = getCurrentUserId();

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to delete project: ${error.message}`);
  }
}

export async function getProjectById(projectId: string) {
  const supabase = await supabaseServer();
  const userId = getCurrentUserId();

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle<ProjectRow>();

  if (error) {
    throw new Error(`Failed to load project: ${error.message}`);
  }

  return data;
}
