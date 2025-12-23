import OpenAI from "openai";
import type { ClientOptions } from "openai";

type LogLevel = "off" | "error" | "warn" | "info" | "debug";

const parseOptionalInt = (value?: string | null) => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const DEFAULT_TIMEOUT_MS = parseOptionalInt(process.env.OPENAI_TIMEOUT_MS);
const DEFAULT_MAX_RETRIES = parseOptionalInt(process.env.OPENAI_MAX_RETRIES);
const DEFAULT_LOG_LEVEL = process.env.OPENAI_LOG as LogLevel | undefined;

export const buildOpenAIClientOptions = (overrides: ClientOptions = {}): ClientOptions => ({
  ...overrides,
  timeout: overrides.timeout ?? DEFAULT_TIMEOUT_MS,
  maxRetries: overrides.maxRetries ?? DEFAULT_MAX_RETRIES,
  logLevel: overrides.logLevel ?? DEFAULT_LOG_LEVEL,
  logger: overrides.logger ?? console,
});

export const createOpenAIClient = (overrides: ClientOptions = {}) =>
  new OpenAI(buildOpenAIClientOptions(overrides));

export const getOpenAIRequestId = (data?: unknown, raw?: Response | null) => {
  if (data && typeof data === "object" && "_request_id" in data) {
    const record = data as { _request_id?: string | null };
    if (record._request_id) return record._request_id;
  }
  return raw?.headers?.get("x-request-id") ?? undefined;
};
