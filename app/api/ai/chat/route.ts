/**
 * POST /api/ai/chat — the assistant chat endpoint (Spec 7.1).
 *
 * Lifecycle: session identity (server-side Supabase Auth) -> input limits ->
 * per-user rate limit -> pre-model permission guard -> [provider tool-calling
 * loop, max 3 rounds, 15s timeout] OR grounded mock -> answer with the
 * ai_generated label -> chat_messages rows (per user, DB-backed history) ->
 * audit trail row. Tool calls execute with the caller's JWT so RLS applies;
 * the browser never talks to the AI provider (AT-11).
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
import { appendAuditEvent, appendAuditEventAsync, ipFromRequest } from "@/lib/audit";
import {
  checkFeaturePermission,
  guardRequest,
  type SessionIdentity,
} from "@/lib/permissions";
import {
  buildChatSystemPrompt,
  currentMoment,
  POLICY_VERSION,
  TOOL_ROUNDS_FALLBACK,
} from "@/lib/prompt";
import { checkRateLimit, RATE_LIMIT } from "@/lib/rateLimit";
import { runMockAssistant, guardRefusalMessage } from "@/lib/mockAssistant";
import { requireSession } from "@/lib/session";
import { supabaseServer, supabaseConfigured } from "@/lib/supabase/server";
import { executeTool } from "@/lib/tools";

const MAX_MESSAGE_LENGTH = 1000;
const MAX_TOOL_ROUNDS = 3;
const HISTORY_WINDOW = 8; // messages of stored context per conversation

const FALLBACK_TIMEOUT =
  "The assistant took too long to respond. Please try again in a moment.";
const FALLBACK_PROVIDER =
  "The assistant is unavailable right now, but the rest of HCM Lite is unaffected. Please try again shortly.";
const FALLBACK_ROUNDS = TOOL_ROUNDS_FALLBACK;

export async function POST(request: Request) {
  if (!supabaseConfigured()) {
    return Response.json({ configured: false, error: "The database is not configured yet." }, { status: 503 });
  }
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const session: SessionIdentity = auth.session;
  const supabase = await supabaseServer();
  const started = Date.now();

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
  const conversationId =
    typeof body?.conversation_id === "string" && body.conversation_id
      ? body.conversation_id
      : randomUUID();

  const storeMessage = async (role: "user" | "assistant", content: string, toolsUsed: string[] = [], refused = false) => {
    await supabase.from("chat_messages").insert({
      user_id: session.userId,
      conversation_id: conversationId,
      role,
      content,
      tools_used: toolsUsed,
      refused,
    });
  };

  // Rate limit (per user, server-side).
  const rate = checkRateLimit(session.userId);
  if (!rate.allowed) {
    appendAuditEvent({
      action: "ai_call",
      actor: { userId: session.userId, name: session.name, role: session.role },
      targetType: "ai_request",
      targetId: "chat",
      ip: ipFromRequest(request),
      details: { feature: "chat", outcome: "rate_limited", error_code: "rate_limited" },
    });
    return Response.json(
      { error: `You've reached the limit of ${RATE_LIMIT} assistant requests per hour. Please try again later.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }

  // Permission guard BEFORE the model sees anything (Art. III.6).
  const guard = guardRequest(message);
  if (guard.blocked) {
    const refusal = guardRefusalMessage(guard.kind ?? "sensitive_pii", message);
    appendAuditEvent({
      action: "ai_permission_denied",
      actor: { userId: session.userId, name: session.name, role: session.role },
      targetType: "ai_request",
      targetId: "chat",
      ip: ipFromRequest(request),
      details: { feature: "chat", guard: guard.kind },
    });
    await storeMessage("user", message);
    await storeMessage("assistant", refusal, [], true);
    return Response.json({
      answer: refusal,
      ai_generated: true,
      refused: true,
      tools_used: [],
      conversation_id: conversationId,
      meta: { date: now.dateLabel, timezone: now.timezone, policy_version: POLICY_VERSION, provider: "guard" },
    });
  }

  if (!checkFeaturePermission(session.role, "chat")) {
    return Response.json({ error: "Not allowed." }, { status: 403 });
  }

  let answer = "";
  let toolsUsed: string[] = [];
  let provider: "gemini" | "mock" = "mock";
  let fallbackUsed = false;
  let promptTokens = 0;
  let completionTokens = 0;
  let errorCode: string | null = null;

  try {
    if (!AI_ENABLED) {
      const mock = await runMockAssistant(supabase, message, session);
      answer = mock.answer;
      toolsUsed = mock.toolsUsed;
      provider = "mock";
      completionTokens = Math.ceil(answer.length / 4);
    } else {
      provider = "gemini";
      const { data: historyRows } = await supabase
        .from("chat_messages")
        .select("role, content")
        .eq("user_id", session.userId)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(HISTORY_WINDOW);
      const history = (historyRows ?? []).reverse().map((m) => ({
        role: m.role as "user" | "model",
        text: m.content as string,
      }));

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
          errorCode = "too_many_tool_rounds";
          break;
        }

        const envelope = await executeTool(supabase, call.name, call.args, session, { feature: "chat" });
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
    // Fail soft: on any provider failure, fall back to the grounded mock so
    // the user still receives a real, database-backed answer. The failure is
    // logged server-side — silent fallbacks hide outages.
    errorCode = err instanceof AiTimeoutError ? "ai_timeout" : "provider_error";
    console.error(`[hcm] AI provider failure for user ${session.userId}:`, err);
    try {
      const mock = await runMockAssistant(supabase, message, session);
      answer = mock.answer;
      toolsUsed = mock.toolsUsed;
      provider = "mock";
      fallbackUsed = true;
    } catch {
      answer = err instanceof AiTimeoutError ? FALLBACK_TIMEOUT : FALLBACK_PROVIDER;
      provider = AI_ENABLED ? "gemini" : "mock";
    }
  }

  // Persist the conversation (per user, DB-backed history — Checklist C.11).
  try {
    await storeMessage("user", message);
    await storeMessage("assistant", answer, toolsUsed);
  } catch {
    // history persistence is best-effort; the answer still returns
  }

  appendAuditEvent({
    action: "ai_call",
    actor: { userId: session.userId, name: session.name, role: session.role },
    targetType: "ai_request",
    targetId: "chat",
    ip: ipFromRequest(request),
    details: {
      feature: "chat",
      outcome: "answered",
      latency_ms: Date.now() - started,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      provider: fallbackUsed ? "mock (provider fallback)" : provider,
      error_code: errorCode,
    },
  });
  void appendAuditEventAsync; // (kept for routes that need durable writes)

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
      provider: fallbackUsed ? "mock (provider fallback)" : provider,
    },
  });
}

/** GET — chat history for the latest (or given) conversation, per user. */
export async function GET(request: Request) {
  if (!supabaseConfigured()) {
    return Response.json({ configured: false, error: "The database is not configured yet." }, { status: 503 });
  }
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const supabase = await supabaseServer();

  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversation_id");

  if (conversationId) {
    const { data } = await supabase
      .from("chat_messages")
      .select("role, content, tools_used, refused, created_at")
      .eq("user_id", auth.session.userId)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(100);
    return Response.json({ conversation_id: conversationId, messages: data ?? [] });
  }

  // Latest conversation for this user.
  const { data: latest } = await supabase
    .from("chat_messages")
    .select("conversation_id")
    .eq("user_id", auth.session.userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const id = latest?.[0]?.conversation_id;
  if (!id) return Response.json({ conversation_id: null, messages: [] });

  const { data } = await supabase
    .from("chat_messages")
    .select("role, content, tools_used, refused, created_at")
    .eq("user_id", auth.session.userId)
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(100);
  return Response.json({ conversation_id: id, messages: data ?? [] });
}
