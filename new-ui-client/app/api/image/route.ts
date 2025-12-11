export const runtime = "nodejs";

import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import OpenAI from "openai";

import { getServerSupabaseClient } from "@/lib/serverSupabase";

const IMAGE_MODEL_LABELS: Record<ImageModelKey, string> = {
  "gpt-image-1": "GPT Image",
  "gpt-image-1-mini": "GPT Image Mini",
};

type ImageModelKey = "gpt-image-1" | "gpt-image-1-mini";

type GeneratedImage = {
  id: string;
  dataUrl: string;
  model: ImageModelKey;
  prompt?: string;
};

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable");
  }
  return new OpenAI({ apiKey });
}

function pickImageModel(prompt: string): ImageModelKey {
  const normalized = prompt.toLowerCase();
  if (
    normalized.length > 280 ||
    /photoreal|unreal|octane|render|intricate|detailed|concept/i.test(normalized)
  ) {
    return "gpt-image-1";
  }
  return "gpt-image-1-mini";
}

function normalizeImageModel(value: unknown): ImageModelKey | null {
  if (value === "gpt-image-1" || value === "gpt-image-1-mini") {
    return value;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const prompt = (body.prompt ?? "").toString().trim();
    const conversationId = (body.conversationId ?? "").toString();
    const requestedModel = normalizeImageModel(body.model);
    const retryAssistantMessageId =
      typeof body.retryAssistantMessageId === "string" &&
      body.retryAssistantMessageId.trim().length > 0
        ? body.retryAssistantMessageId.trim()
        : null;
    const retryUserMessageId =
      typeof body.retryUserMessageId === "string" &&
      body.retryUserMessageId.trim().length > 0
        ? body.retryUserMessageId.trim()
        : null;

    if (!conversationId) {
      return NextResponse.json(
        { error: "Missing conversation" },
        { status: 400 }
      );
    }

    if (!prompt) {
      return NextResponse.json(
        { error: "Missing prompt" },
        { status: 400 }
      );
    }

    const supabase = getServerSupabaseClient();

    let userRowId: string | null = retryUserMessageId ?? null;
    let assistantRowId: string | null = retryAssistantMessageId ?? null;

    if (!retryAssistantMessageId && retryUserMessageId) {
      return NextResponse.json(
        { error: "Missing assistant retry id" },
        { status: 400 }
      );
    }

    if (!retryAssistantMessageId) {
      const { data: userRow, error: userInsertError } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          role: "user",
          content: prompt,
        })
        .select("id")
        .single();

      if (userInsertError) {
        console.error("Failed to persist user image prompt", userInsertError);
      }
      userRowId = userRow?.id ?? null;
    } else {
      await supabase
        .from("messages")
        .update({ content: "", metadata: null })
        .eq("id", retryAssistantMessageId)
        .eq("conversation_id", conversationId);
    }

    const openai = getOpenAIClient();
    const targetModel = requestedModel ?? pickImageModel(prompt);

    const result = await openai.images.generate({
      model: targetModel,
      prompt,
      size: "1024x1024",
      n: 1,
    });

    const generatedImages: GeneratedImage[] = (result.data || [])
      .map((entry) => {
        if (!entry.b64_json) {
          return null;
        }
        return {
          id: randomUUID(),
          dataUrl: `data:image/png;base64,${entry.b64_json}`,
          model: targetModel,
          prompt,
        } satisfies GeneratedImage;
      })
      .filter(Boolean) as GeneratedImage[];

    if (!generatedImages.length) {
      return NextResponse.json(
        { error: "No image generated" },
        { status: 502 }
      );
    }

    const assistantContent =
      generatedImages.length > 1
        ? "Created the requested images."
        : "Created the requested image.";
    const metadataPayload = {
      usedModel: targetModel,
      generationType: "image",
      generatedImages,
      imagePrompt: prompt,
      imageModelLabel: IMAGE_MODEL_LABELS[targetModel],
    };

    if (!assistantRowId) {
      const { data: assistantRow, error: assistantInsertError } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          role: "assistant",
          content: assistantContent,
          metadata: metadataPayload,
        })
        .select("id")
        .single();

      if (assistantInsertError) {
        console.error("Failed to persist assistant image response", assistantInsertError);
      }
      assistantRowId = assistantRow?.id ?? null;
    } else {
      await supabase
        .from("messages")
        .update({
          content: assistantContent,
          metadata: metadataPayload,
        })
        .eq("id", assistantRowId);
    }

    return NextResponse.json({
      assistantMessageId: assistantRowId,
      userMessageId: userRowId,
      images: generatedImages,
      usedModel: targetModel,
      metadata: metadataPayload,
      content: assistantContent,
    });
  } catch (error) {
    console.error("Image generation failed", error);
    return NextResponse.json(
      { error: "image_generation_failed" },
      { status: 500 }
    );
  }
}
