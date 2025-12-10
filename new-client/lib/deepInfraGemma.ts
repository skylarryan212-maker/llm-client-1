import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

let cachedClient: OpenAI | null = null;

function getClient() {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPINFRA_API_KEY is not set");
  }
  cachedClient = new OpenAI({
    apiKey,
    baseURL: "https://api.deepinfra.com/v1/openai",
  });
  return cachedClient;
}

export async function callDeepInfraGemma({
  messages,
  schemaName,
  schema,
  maxTokens = 400,
  enforceJson = true,
}: {
  messages: ChatCompletionMessageParam[];
  schemaName?: string;
  schema?: any;
  maxTokens?: number;
  enforceJson?: boolean;
}): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }> {
  const client = getClient();

  const schemaNudge =
    schema && schemaName
      ? `You must return a JSON object matching the schema "${schemaName}": ${JSON.stringify(schema)}`
      : "";

  const finalMessages: ChatCompletionMessageParam[] = schemaNudge
    ? [{ role: "system", content: schemaNudge }, ...messages]
    : messages;

  const completion = await client.chat.completions.create({
    model: "google/gemma-3-4b-it",
    messages: finalMessages,
    temperature: 0,
    max_tokens: maxTokens,
    response_format: enforceJson ? { type: "json_object" } : undefined,
  });

  const text = completion.choices?.[0]?.message?.content?.trim() ?? "";
  const usage = completion.usage || {};

  return {
    text,
    usage: {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
    },
  };
}
