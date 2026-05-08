#!/usr/bin/env node
/**
 * Smoke tests for src/ontology/contextBudget.js.
 * Run: node scripts/test-context-budget.js
 *
 * Goals:
 *   - estimateTokens behaves like a chars/4 ceiling.
 *   - estimatePayload sums system + per-message envelope costs.
 *   - truncateMessages drops from the head until the budget fits, but
 *     never drops below MIN_KEEP_TAIL_MESSAGES and never drops the last turn.
 *   - prepareApiPayload returns a usable summary and trimmed messages.
 */

import {
  estimateTokens,
  estimateMessageTokens,
  estimatePayload,
  truncateMessages,
  prepareApiPayload,
  usageStatus,
  formatTokens,
  SOFT_LIMIT,
} from '../src/ontology/contextBudget.js';

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${label}`); }
}
function eq(actual, expected, label) {
  assert(actual === expected, `${label} — expected ${expected}, got ${actual}`);
}

// ─── estimateTokens ──────────────────────────────────────────────────────────
console.log('estimateTokens');
eq(estimateTokens(""), 0, 'empty string -> 0');
eq(estimateTokens(null), 0, 'null -> 0');
eq(estimateTokens(undefined), 0, 'undefined -> 0');
eq(estimateTokens("abcd"), 1, '4 chars -> 1 token');
eq(estimateTokens("abcde"), 2, '5 chars -> ceil(5/4)=2');
eq(estimateTokens("a".repeat(400)), 100, '400 chars -> 100 tokens');
// JSON-stringifies non-strings
assert(estimateTokens({ a: 1 }) > 0, 'object input is JSON-stringified, not 0');

// ─── estimateMessageTokens ───────────────────────────────────────────────────
console.log('estimateMessageTokens');
eq(estimateMessageTokens(null), 0, 'null message -> 0');
// content of 4 chars + 4 envelope = 5 tokens
eq(estimateMessageTokens({ role: 'user', content: 'abcd' }), 5, 'envelope adds ~4 tokens');

// ─── estimatePayload ─────────────────────────────────────────────────────────
console.log('estimatePayload');
{
  const result = estimatePayload({
    system: 'a'.repeat(40),                 // 10 tokens
    messages: [
      { role: 'user', content: 'a'.repeat(40) },     // 10 + 4
      { role: 'assistant', content: 'a'.repeat(80) },// 20 + 4
    ],
  });
  eq(result.systemTokens, 10, 'system tokens');
  eq(result.messageTokens, 38, 'message tokens (14 + 24)');
  eq(result.total, 48, 'total system + messages');
  eq(result.perMessage.length, 2, 'perMessage entry per message');
}

// ─── truncateMessages: under budget no-ops ───────────────────────────────────
console.log('truncateMessages: under budget');
{
  const messages = [
    { role: 'user', content: 'short' },
    { role: 'assistant', content: 'reply' },
  ];
  const out = truncateMessages(messages, { systemTokens: 100, softLimit: 1000 });
  eq(out.dropped, 0, 'nothing dropped');
  eq(out.messages.length, 2, 'all messages kept');
  eq(out.fit, true, 'fits the budget');
}

// ─── truncateMessages: drops from head ───────────────────────────────────────
console.log('truncateMessages: drops from head when over budget');
{
  // Each message ~ 25 tokens (80 chars / 4 + 4 envelope). 8 messages = 200 tokens.
  const big = 'a'.repeat(80);
  const messages = Array.from({ length: 8 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: big + ` (turn ${i})`,
  }));
  const out = truncateMessages(messages, { systemTokens: 0, softLimit: 80, minTail: 2 });
  assert(out.dropped > 0, 'some messages dropped');
  // Tail floor of 2 means at most 6 dropped; last message must be kept.
  assert(out.messages.length >= 2, 'tail floor respected');
  eq(out.messages[out.messages.length - 1], messages[messages.length - 1], 'last message preserved');
}

// ─── truncateMessages: tail floor wins over budget ───────────────────────────
console.log('truncateMessages: tail floor wins over budget');
{
  const huge = 'a'.repeat(4000); // ~1000 tokens + 4 envelope
  const messages = Array.from({ length: 5 }, () => ({ role: 'user', content: huge }));
  const out = truncateMessages(messages, { systemTokens: 0, softLimit: 100, minTail: 4 });
  // Budget is way too small but minTail=4 forces us to keep at least 4.
  eq(out.messages.length, 4, 'kept exactly minTail messages');
  assert(out.fit === false, 'reports !fit when tail floor exceeds budget');
}

// ─── truncateMessages: empty input ───────────────────────────────────────────
console.log('truncateMessages: empty input');
{
  const out = truncateMessages([], { systemTokens: 0, softLimit: 1000 });
  eq(out.messages.length, 0, 'empty -> empty');
  eq(out.dropped, 0, 'empty -> 0 dropped');
  eq(out.fit, true, 'empty -> fits');
}

// ─── prepareApiPayload integrates correctly ──────────────────────────────────
console.log('prepareApiPayload');
{
  const big = 'a'.repeat(8000); // ~2000 + 4 = 2004 tokens per message
  const messages = Array.from({ length: 6 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: big,
  }));
  const out = prepareApiPayload(
    { system: 'sys', messages },
    { softLimit: 5000, minTail: 2 },
  );
  assert(out.usage.dropped > 0, 'some history was dropped');
  assert(out.messages.length >= 2, 'tail respected');
  eq(out.messages[out.messages.length - 1], messages[messages.length - 1], 'final message preserved');
  assert(out.usage.total <= 5000 || out.usage.fit === false, 'either fits or signals !fit');
  eq(out.system, 'sys', 'system passed through unchanged');
}

// ─── usageStatus thresholds ──────────────────────────────────────────────────
console.log('usageStatus thresholds');
eq(usageStatus(0.0), 'ok', '0% -> ok');
eq(usageStatus(0.59), 'ok', '59% -> ok');
eq(usageStatus(0.6), 'warn', '60% -> warn');
eq(usageStatus(0.84), 'warn', '84% -> warn');
eq(usageStatus(0.85), 'hot', '85% -> hot');
eq(usageStatus(1.5), 'hot', '>100% -> hot');

// ─── formatTokens ────────────────────────────────────────────────────────────
console.log('formatTokens');
eq(formatTokens(0), '0', 'zero');
eq(formatTokens(999), '999', 'sub-1K stays integer');
eq(formatTokens(1000), '1.0K', 'exactly 1K');
eq(formatTokens(14207), '14.2K', '14207 -> 14.2K');
eq(formatTokens(null), '0', 'null -> 0');

// ─── SOFT_LIMIT sanity ───────────────────────────────────────────────────────
console.log('SOFT_LIMIT sanity');
assert(SOFT_LIMIT > 100_000 && SOFT_LIMIT < 200_000, 'SOFT_LIMIT in expected range');

// ─── Result ──────────────────────────────────────────────────────────────────
console.log('');
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
