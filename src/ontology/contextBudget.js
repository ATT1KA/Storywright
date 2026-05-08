/**
 * Context Window Budget Manager
 *
 * Conversations in Storywright accumulate unbounded message history while the
 * system prompt also carries the ontology snapshot (which can be substantial
 * once a story bible is loaded). Without a bound, requests creep toward the
 * model's 200K context window — first inflating cost, then failing outright.
 *
 * This module is the single source of truth for:
 *   - estimating token cost of strings, messages, and full payloads,
 *   - applying a sliding-window truncation policy that always preserves the
 *     latest user turn (and prefers to keep the most recent assistant turn so
 *     the user's "Send" never silently strands their question without context),
 *   - exposing a usage summary the UI can render as a meter.
 *
 * The estimator is intentionally cheap (chars/4) — accurate enough to drive
 * UX guardrails, no tokenizer dependency. Replace with a real tokenizer if/when
 * the project takes one on. The shape of this API is designed to survive that
 * swap: callers pass strings, we return token counts.
 */

// Claude Sonnet/Opus context window. Conservative; the ceiling we never want to hit.
export const MODEL_CONTEXT_WINDOW = 200_000;

// Reserve for the assistant's response. Matches `max_tokens` in storywright.jsx
// with a margin for the SSE envelope. Keep slightly above the API max_tokens.
export const OUTPUT_RESERVE = 4_000;

// Soft cap for input tokens. We start dropping older history above this.
// Chosen well below MODEL_CONTEXT_WINDOW - OUTPUT_RESERVE so the user has
// breathing room to keep typing before truncation kicks in.
export const SOFT_LIMIT = 160_000;

// Floor we won't truncate below: even after dropping older turns we leave
// enough budget for the system prompt + the latest user turn to land safely.
const MIN_KEEP_TAIL_MESSAGES = 4;

/**
 * Cheap token estimator. Claude tokenization averages ~3.5–4 chars per token
 * for English prose; we pick 4 to slightly under-count rather than over-count
 * (under-counting is the safer error: the API will warn before we truncate
 * unnecessarily). For non-string inputs we coerce to JSON first.
 */
export function estimateTokens(text) {
  if (text == null) return 0;
  const str = typeof text === "string" ? text : JSON.stringify(text);
  if (!str) return 0;
  return Math.ceil(str.length / 4);
}

/**
 * Estimate tokens for a single message in Anthropic's chat format.
 * Adds a small per-message envelope (role markers + framing) so the running
 * total tracks reality more closely.
 */
export function estimateMessageTokens(message) {
  if (!message) return 0;
  const content = typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content || "");
  // ~4 tokens of envelope per message (role tags, separators).
  return estimateTokens(content) + 4;
}

/**
 * Compute the full input-token estimate for a payload.
 * Returns a structured breakdown so the UI can show where tokens are going.
 */
export function estimatePayload({ system = "", messages = [] }) {
  const systemTokens = estimateTokens(system);
  const perMessage = messages.map(estimateMessageTokens);
  const messageTokens = perMessage.reduce((a, b) => a + b, 0);
  return {
    systemTokens,
    messageTokens,
    perMessage,
    total: systemTokens + messageTokens,
  };
}

/**
 * Sliding-window truncation policy.
 *
 * Strategy: we always preserve the tail (most recent turns) because the user's
 * latest message must reach the model with context for the model's prior reply.
 * We drop from the head (oldest turns) until the total fits under the budget.
 *
 * Invariants:
 *   - The last message is never dropped.
 *   - We try to keep at least MIN_KEEP_TAIL_MESSAGES turns, even if that
 *     pushes us over budget — under-context is worse than slight overage.
 *   - We never split a single message; truncation is per-message.
 *
 * Returns { messages, dropped, droppedTokens, fit } so callers can warn the UI.
 */
export function truncateMessages(messages, opts = {}) {
  const {
    systemTokens = 0,
    softLimit = SOFT_LIMIT,
    minTail = MIN_KEEP_TAIL_MESSAGES,
  } = opts;

  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages: [], dropped: 0, droppedTokens: 0, fit: true };
  }

  const perMessage = messages.map(estimateMessageTokens);
  const budget = Math.max(0, softLimit - systemTokens);

  // If we're already within budget, nothing to do.
  let total = perMessage.reduce((a, b) => a + b, 0);
  if (total <= budget) {
    return { messages, dropped: 0, droppedTokens: 0, fit: true };
  }

  // Drop from the head. Stop when we either fit or hit the tail floor.
  let dropIdx = 0;
  let droppedTokens = 0;
  const maxDrop = Math.max(0, messages.length - minTail);
  while (dropIdx < maxDrop && total > budget) {
    droppedTokens += perMessage[dropIdx];
    total -= perMessage[dropIdx];
    dropIdx += 1;
  }

  return {
    messages: messages.slice(dropIdx),
    dropped: dropIdx,
    droppedTokens,
    fit: total <= budget,
  };
}

/**
 * Convenience: prepare a payload for the API by truncating in place.
 * Returns the trimmed payload and a usage summary for the UI.
 */
export function prepareApiPayload({ system = "", messages = [] }, opts = {}) {
  const systemTokens = estimateTokens(system);
  const trimmed = truncateMessages(messages, { ...opts, systemTokens });
  const finalEstimate = estimatePayload({ system, messages: trimmed.messages });
  return {
    system,
    messages: trimmed.messages,
    usage: {
      systemTokens,
      messageTokens: finalEstimate.messageTokens,
      total: finalEstimate.total,
      dropped: trimmed.dropped,
      droppedTokens: trimmed.droppedTokens,
      fit: trimmed.fit,
      softLimit: opts.softLimit ?? SOFT_LIMIT,
      modelWindow: MODEL_CONTEXT_WINDOW,
    },
  };
}

/**
 * Bucket a usage ratio into a status: ok / warn / hot. Used by the UI meter
 * so the threshold logic lives in one place.
 */
export function usageStatus(ratio) {
  if (ratio >= 0.85) return "hot";
  if (ratio >= 0.6) return "warn";
  return "ok";
}

/**
 * Format a token count for compact UI display: 14207 -> "14.2K".
 */
export function formatTokens(n) {
  if (n == null || isNaN(n)) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
