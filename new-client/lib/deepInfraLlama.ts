import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { createOpenAIClient, getOpenAIRequestId } from "@/lib/openai/client";

let cachedClient: OpenAI | null = null;

function getClient() {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPINFRA_API_KEY is not set");
  }
  cachedClient = createOpenAIClient({
    apiKey,
    baseURL: "https://api.deepinfra.com/v1/openai",
  });
  return cachedClient;
}

export async function callDeepInfraLlama({
  messages,
  schemaName,
  schema,
  maxTokens = 400,
  model = "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
  temperature = 1.0,
  enforceJson = true,
}: {
  messages: ChatCompletionMessageParam[];
  schemaName?: string;
  schema?: any;
  maxTokens?: number;
  model?: string;
  temperature?: number;
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

  const { data: completion, response: rawResponse } = await client.chat.completions
    .create({
      model,
      messages: finalMessages,
      temperature,
      max_tokens: maxTokens,
      response_format: enforceJson ? { type: "json_object" } : undefined,
    })
    .withResponse();
  const requestId = getOpenAIRequestId(completion, rawResponse);
  if (requestId) {
    console.log("[deepinfra] OpenAI request id", { requestId });
  }

  const text = completion.choices?.[0]?.message?.content?.trim() ?? "";
  const usage: any = completion.usage || {};

  return {
    text,
    usage: {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
    },
  };
}
