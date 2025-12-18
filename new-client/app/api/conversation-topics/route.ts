export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserIdServer } from "@/lib/supabase/user";
import type { Database } from "@/lib/supabase/types";

export async function GET() {
  const userId = await getCurrentUserIdServer();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await supabaseServer();
  const supabaseAny = supabase as any;

  const { data: conversations, error: convoErr } = await supabaseAny
    .from("conversations")
    .select("id, title, project_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (convoErr || !Array.isArray(conversations)) {
    return NextResponse.json({ error: "Failed to load conversations" }, { status: 500 });
  }

  const conversationIds = conversations.map((c) => c.id).filter(Boolean);
  if (!conversationIds.length) {
    return NextResponse.json({ topics: [] });
  }

  const projectIds = Array.from(
    new Set(conversations.map((c) => c.project_id).filter(Boolean))
  ) as string[];

  const projectNameById = new Map<string, string>();
  if (projectIds.length) {
    const { data: projects } = await supabaseAny
      .from("projects")
      .select("id, name")
      .in("id", projectIds);

    (projects ?? []).forEach((p: any) => {
      if (p?.id && typeof p.name === "string") {
        projectNameById.set(p.id, p.name);
      }
    });
  }

  const conversationMetaById = new Map<
    string,
    { title: string | null; projectId: string | null; projectName: string | null }
  >();
  conversations.forEach((c) => {
    conversationMetaById.set(c.id, {
      title: c.title ?? null,
      projectId: c.project_id ?? null,
      projectName: c.project_id ? projectNameById.get(c.project_id) ?? null : null,
    });
  });

  const { data: topics, error: topicErr } = await supabaseAny
    .from("conversation_topics")
    .select("id, conversation_id, parent_topic_id, label, description, summary, token_estimate, created_at, updated_at")
    .in("conversation_id", conversationIds)
    .order("updated_at", { ascending: false })
    .limit(500);

  if (topicErr || !Array.isArray(topics)) {
    return NextResponse.json({ error: "Failed to load topics" }, { status: 500 });
  }

  return NextResponse.json({
    topics: topics.map((t) => {
      const meta = conversationMetaById.get(t.conversation_id);
      return {
        id: t.id,
        conversationId: t.conversation_id,
        parentTopicId: t.parent_topic_id,
        label: t.label,
        description: t.description,
        summary: t.summary,
        tokenEstimate: t.token_estimate,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        conversationTitle: meta?.title ?? null,
        projectId: meta?.projectId ?? null,
        projectName: meta?.projectName ?? null,
      };
    }),
  });
}
