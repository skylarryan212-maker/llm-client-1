import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

type CFMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

interface CFResponse {
  result?: {
    response?: string;
    output_text?: string;
    messages?: Array<{ content?: string }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  errors?: unknown;
}

export async function callCloudflareLlama({
  messages,
  schemaName,
  schema,
}: {
  messages: ChatCompletionMessageParam[];
  schemaName?: string;
  schema?: any;
}): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }> {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_WORKERS_AI_TOKEN;
  if (!accountId || !token) {
    throw new Error("Cloudflare AI credentials missing (CF_ACCOUNT_ID or CF_WORKERS_AI_TOKEN)");
  }

  const cfMessages: CFMessage[] = messages.map((m) => ({
    role: (m.role as "system" | "user" | "assistant") ?? "user",
    content: typeof (m as any).content === "string" ? (m as any).content : JSON.stringify((m as any).content ?? ""),
  }));

  const body: Record<string, unknown> = {
    messages: cfMessages,
  };

  // Pass schema as guidance text since CF endpoint doesn’t enforce JSON schema
  if (schema && schemaName) {
    const schemaText = `You must strictly output JSON matching this schema named "${schemaName}": ${JSON.stringify(
      schema
    )}`;
    body.messages = [
      { role: "system", content: schemaText },
      ...cfMessages,
    ];
  }

  const resp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.2-1b-instruct`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`[cf-llama] HTTP ${resp.status}: ${text}`);
  }

  const json = (await resp.json()) as CFResponse;
  const result = json.result || {};
  const usage = result.usage || {};
  const text =
    result.output_text ||
    result.response ||
    (Array.isArray(result.messages) ? result.messages.map((m) => m?.content || "").join("\n") : "") ||
    "";

  return {
    text: text.trim(),
    usage: {
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
    },
  };
}
