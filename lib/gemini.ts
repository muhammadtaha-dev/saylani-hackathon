/**
 * HCM Lite — LLM provider client wrapper (Art. III.1, Art. VIII).
 *
 * The API key exists only in backend environment variables (AI_API_KEY or
 * GEMINI_API_KEY) and is never exposed to the browser, responses or logs.
 * The browser only ever calls internal /api/ai/* routes (AT-11).
 * Every provider call is wrapped with a 15-second timeout and mapped to
 * typed errors — no blind retries (NFR-04, NFR-08).
 */

import {
  GoogleGenerativeAI,
  type FunctionDeclaration,
  type GenerateContentRequest,
  type GenerateContentResult,
} from "@google/generative-ai";
import { GEMINI_TOOL_DECLARATIONS } from "./tools";

export const AI_TIMEOUT_MS = 15000;
export const MAX_OUTPUT_TOKENS = 700;

/**
 * The API key comes ONLY from environment variables (GEMINI_API_KEY or
 * AI_API_KEY). A previously committed base64-encoded fallback key was
 * removed (Loop 1 audit): a secret in source is public the moment the repo
 * is, and violates the "never hard-code secrets" ground rule. That key must
 * be rotated in Google AI Studio. With no key configured the app runs the
 * grounded mock assistant, which answers from the same tools.
 */
const API_KEY = (process.env.GEMINI_API_KEY ?? process.env.AI_API_KEY ?? "").trim();

/** False when no key is available at all — routes fall back to the grounded mock. */
export const AI_ENABLED = API_KEY.length > 0;

// gemini-1.5-flash has been retired by Google (404); gemini-2.5-flash is the
// current Flash generation and was verified for tool calling + JSON mode.
export const AI_MODEL = "gemini-2.5-flash";

// Thinking is disabled: gemini-2.5 spends thought tokens from the output
// budget, which can truncate short answers. The tasks here don't need it.
const THINKING_OFF = { thinkingConfig: { thinkingBudget: 0 } };

export class AiTimeoutError extends Error {
  constructor() {
    super("ai_timeout");
    this.name = "AiTimeoutError";
  }
}

export class AiProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderError";
  }
}

const client = AI_ENABLED ? new GoogleGenerativeAI(API_KEY) : null;

function assertClient(): GoogleGenerativeAI {
  if (!client) throw new AiProviderError("AI provider is not configured");
  return client;
}

export function getChatModel(systemInstruction: string) {
  return assertClient().getGenerativeModel(
    {
      model: AI_MODEL,
      systemInstruction,
      tools: [
        { functionDeclarations: GEMINI_TOOL_DECLARATIONS as unknown as FunctionDeclaration[] },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        ...THINKING_OFF,
      } as never,
    },
    { timeout: AI_TIMEOUT_MS }
  );
}

export function getJsonModel(systemInstruction: string, maxTokens = 500) {
  return assertClient().getGenerativeModel(
    {
      model: AI_MODEL,
      systemInstruction,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: maxTokens,
        responseMimeType: "application/json",
        ...THINKING_OFF,
      } as never,
    },
    { timeout: AI_TIMEOUT_MS }
  );
}

export async function generateWithTimeout(
  model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>,
  request: string | GenerateContentRequest
): Promise<GenerateContentResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AiTimeoutError()), AI_TIMEOUT_MS);
  });
  try {
    return (await Promise.race([model.generateContent(request), timeoutPromise])) as GenerateContentResult;
  } catch (err) {
    if (err instanceof AiTimeoutError) throw err;
    throw new AiProviderError(err instanceof Error ? err.message : "provider failure");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export function usageOf(result: GenerateContentResult): TokenUsage {
  const usage = result.response.usageMetadata;
  return {
    promptTokens: usage?.promptTokenCount ?? 0,
    completionTokens: usage?.candidatesTokenCount ?? 0,
  };
}

export function textOf(result: GenerateContentResult): string {
  return result.response.text?.() ?? "";
}

export function firstFunctionCall(
  result: GenerateContentResult
): { name: string; args: Record<string, unknown> } | null {
  const parts = result.response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.functionCall) {
      return {
        name: part.functionCall.name ?? "",
        args: (part.functionCall.args ?? {}) as Record<string, unknown>,
      };
    }
  }
  return null;
}

export function modelPartsOf(result: GenerateContentResult) {
  return result.response.candidates?.[0]?.content?.parts ?? [];
}
