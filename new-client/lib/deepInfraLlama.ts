import type OpenAI from "openai";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { createOpenAIClient, getOpenAIRequestId } from "@/lib/openai/client";

const DEFAULT_BASE_URL = "https://api.deepinfra.com/v1/openai";
const clientCache = new Map<string, OpenAI>();

function getClient(baseURL = DEFAULT_BASE_URL) {
  if (clientCache.has(baseURL)) return clientCache.get(baseURL)!;
  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPINFRA_API_KEY is not set");
  }
  const client = createOpenAIClient({
    apiKey,
    baseURL,
  });
  clientCache.set(baseURL, client);
  return client;
}

async function callDeepInfraChatCompletions({
  apiKey,
  baseURL,
  payload,
}: {
  apiKey: string;
  baseURL: string;
  payload: Record<string, any>;
}): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }> {
  const url = new URL("chat/completions", baseURL.endsWith("/") ? baseURL : `${baseURL}/`);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const bodyText = await response.text();
  let data: any = null;
  if (bodyText) {
    try {
      data = JSON.parse(bodyText);
    } catch {
      data = null;
    }
  }
  const requestId = response.headers.get("x-request-id") ?? data?._request_id;
  if (requestId) {
    console.log("[deepinfra] OpenAI request id", { requestId });
  }
  if (!response.ok) {
    console.error("[deepinfra] chat completions error", {
      status: response.status,
      statusText: response.statusText,
      body: bodyText || null,
      requestId,
    });
    throw new Error(`DeepInfra chat completions failed (${response.status}): ${bodyText || "no body"}`);
  }
  const text = data?.choices?.[0]?.message?.content?.trim() ?? "";
  const usage: any = data?.usage || {};
  return {
    text,
    usage: {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
    },
  };
}

export async function callDeepInfraLlama({
  messages,
  schemaName,
  schema,
  maxTokens = 400,
  model = "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
  temperature = 1.0,
  enforceJson = true,
  extraParams = {},
  baseURL,
}: {
  messages: ChatCompletionMessageParam[];
  schemaName?: string;
  schema?: any;
  maxTokens?: number | null;
  model?: string;
  temperature?: number;
  enforceJson?: boolean;
  extraParams?: Record<string, any>;
  baseURL?: string;
}): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }> {
  const resolvedBaseURL = baseURL ?? DEFAULT_BASE_URL;
  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPINFRA_API_KEY is not set");
  }

  const schemaNudge =
    schema && schemaName
      ? `You must return a JSON object matching the schema "${schemaName}": ${JSON.stringify(schema)}`
      : "";

  const finalMessages: ChatCompletionMessageParam[] = schemaNudge
    ? [{ role: "system", content: schemaNudge }, ...messages]
    : messages;

  const isDeepInfra = resolvedBaseURL.startsWith("https://api.deepinfra.com/");
  const disableJsonObject =
    isDeepInfra && typeof model === "string" && model.includes("gpt-oss-");
  const responseFormat = enforceJson && !disableJsonObject ? { type: "json_object" } : undefined;

  const requestPayload = {
    model,
    messages: finalMessages,
    temperature,
    response_format: responseFormat,
    ...extraParams,
  };
  if (typeof maxTokens === "number") {
    requestPayload.max_tokens = maxTokens;
  }
  if (resolvedBaseURL.startsWith("https://api.deepinfra.com/")) {
    return callDeepInfraChatCompletions({
      apiKey,
      baseURL: resolvedBaseURL,
      payload: requestPayload,
    });
  }

  const client = getClient(resolvedBaseURL);
  const { data: completion, response: rawResponse } = await client.chat.completions
    .create(requestPayload as ChatCompletionCreateParamsNonStreaming)
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
