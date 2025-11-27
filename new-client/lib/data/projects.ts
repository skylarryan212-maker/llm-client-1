import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/supabase/user";
import type { Database } from "@/lib/supabase/types";

type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];

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
