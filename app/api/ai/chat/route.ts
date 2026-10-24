/**
 * POST /api/ai/chat — the assistant chat endpoint (Spec 7.1).
 *
 * Lifecycle: session identity (server-side) -> input limits -> per-user rate
 * limit -> pre-model permission guard -> [provider tool-calling loop, max 3
 * rounds, 15s timeout] OR grounded mock -> answer with ai_generated label ->
 * ai_logs row. The browser never talks to the AI provider (AT-11).
 */

import { randomUUID } from "crypto";
import {
  AI_ENABLED,
  generateWithTimeout,
  firstFunctionCall,
  getChatModel,
  modelPartsOf,
  textOf,
  usageOf,
  AiTimeoutError,
} from "@/lib/gemini";
import { appendAiLog, type AiOutcome } from "@/lib/aiLogs";
import {
  checkFeaturePermission,
  guardRequest,
  GENERIC_REFUSAL,
  type SessionIdentity,
} from "@/lib/permissions";
import {
  buildChatSystemPrompt,
  currentMoment,
  POLICY_VERSION,
  TOOL_ROUNDS_FALLBACK,
} from "@/lib/prompt";
import { checkRateLimit, RATE_LIMIT } from "@/lib/rateLimit";
import { runMockAssistant } from "@/lib/mockAssistant";
import { getSession } from "@/lib/session";
import { executeTool } from "@/lib/tools";

const MAX_MESSAGE_LENGTH = 1000;
const MAX_TOOL_ROUNDS = 3;
const HISTORY_WINDOW = 8; // messages of stored context per conversation

interface StoredMessage {
  role: "user" | "model";
  text: string;
}
const conversations = new Map<string, StoredMessage[]>();

const FALLBACK_TIMEOUT =
  "The assistant took too long to respond. Please try again in a moment.";
const FALLBACK_PROVIDER =
  "The assistant is unavailable right now, but the rest of HCM Lite is unaffected. Please try again shortly.";
const FALLBACK_ROUNDS = TOOL_ROUNDS_FALLBACK;

export async function POST(request: Request) {
  const started = Date.now();
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { message?: unknown; conversation_id?: unknown }
    | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    return Response.json(
      { error: "Please send a message between 1 and 1000 characters." },
      { status: 400 }
    );
  }

  const now = currentMoment();
  const featureBase = "chat" as const;

  // Rate limit (per user, server-side).
  const rate = checkRateLimit(session.userId);
  if (!rate.allowed) {
    appendAiLog(session, {
      feature: featureBase,
      outcome: "rate_limited",
      latency_ms: Date.now() - started,
      provider: "none",
      error_code: "rate_limited",
    });
    return Response.json(
      { error: `You've reached the limit of ${RATE_LIMIT} assistant requests per hour. Please try again later.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }

  // Permission guard BEFORE the model sees anything (Art. III.6).
  const guard = guardRequest(message);
  if (guard.blocked) {
    appendAiLog(session, {
      feature: featureBase,
      outcome: "refused",
      latency_ms: Date.now() - started,
      provider: "none",
      error_code: `guard_${guard.kind}`,
    });
    return Response.json({
      answer: guard.message ?? GENERIC_REFUSAL,
      ai_generated: true,
      refused: true,
      tools_used: [],
      conversation_id: typeof body?.conversation_id === "string" ? body.conversation_id : randomUUID(),
      meta: { date: now.dateLabel, timezone: now.timezone, policy_version: POLICY_VERSION, provider: "guard" },
    });
  }

  const conversationId =
    typeof body?.conversation_id === "string" && body.conversation_id
      ? body.conversation_id
      : randomUUID();

  if (!checkFeaturePermission(session.role, "chat")) {
    return Response.json({ error: "Not allowed." }, { status: 403 });
  }

  let answer = "";
  let toolsUsed: string[] = [];
  let outcome: AiOutcome = "answered";
  let provider: "gemini" | "mock" = "mock";
  let promptTokens = 0;
  let completionTokens = 0;
  let feature: "chat" | "policy" = "chat";
  let errorCode: string | null = null;

  try {
    if (!AI_ENABLED) {
      const mock = await runMockAssistant(message, session);
      answer = mock.answer;
      toolsUsed = mock.toolsUsed;
      feature = mock.feature === "policy" ? "policy" : "chat";
      provider = "mock";
      completionTokens = Math.ceil(answer.length / 4);
    } else {
      provider = "gemini";
      const history = (conversations.get(conversationId) ?? []).slice(-HISTORY_WINDOW);
      const contents: Array<{
        role: "user" | "model";
        parts: Array<
          | { text: string }
          | { functionCall: { name: string; args: Record<string, unknown> } }
          | { functionResponse: { name: string; response: object } }
        >;
      }> = history.map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
      contents.push({ role: "user", parts: [{ text: message }] });

      const model = getChatModel(buildChatSystemPrompt(session.role, session.department));

      for (let executed = 0; ; executed++) {
        const result = await generateWithTimeout(model, { contents });
        const usage = usageOf(result);
        promptTokens += usage.promptTokens;
        completionTokens += usage.completionTokens;

        const call = firstFunctionCall(result);
        if (!call) {
          answer = textOf(result) || FALLBACK_PROVIDER;
          break;
        }
        if (executed >= MAX_TOOL_ROUNDS) {
          answer = FALLBACK_ROUNDS;
          outcome = "fallback";
          errorCode = "too_many_tool_rounds";
          break;
        }

        const envelope = await executeTool(call.name, call.args, session, { feature: featureBase });
        toolsUsed.push(call.name);

        contents.push({ role: "model", parts: modelPartsOf(result) as never });
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: call.name,
                response: { result: envelope as unknown as object },
              },
            },
          ],
        });
      }
    }
  } catch (err) {
    if (err instanceof AiTimeoutError) {
      answer = FALLBACK_TIMEOUT;
      outcome = "timeout";
      errorCode = "ai_timeout";
    } else {
      answer = FALLBACK_PROVIDER;
      outcome = "fallback";
      errorCode = "provider_error";
    }
  }

  // Conversation memory (windowed, server-side).
  const memory = conversations.get(conversationId) ?? [];
  memory.push({ role: "user", text: message });
  memory.push({ role: "model", text: answer });
  while (memory.length > HISTORY_WINDOW) memory.shift();
  conversations.set(conversationId, memory);

  const identity: SessionIdentity = session;
  appendAiLog(identity, {
    feature,
    outcome,
    latency_ms: Date.now() - started,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    provider,
    error_code: errorCode,
  });

  return Response.json({
    answer,
    ai_generated: true,
    refused: false,
    tools_used: toolsUsed,
    conversation_id: conversationId,
    meta: {
      date: now.dateLabel,
      timezone: now.timezone,
      policy_version: POLICY_VERSION,
      provider: AI_ENABLED ? "gemini" : "mock",
    },
  });
}
