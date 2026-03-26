#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { clampField } from '../src/ontology/clamp.js';

const root = path.resolve(import.meta.dirname, '..');
const registry = JSON.parse(readFileSync(path.join(root, 'src', 'ontology', 'constraint_registry.json'), 'utf8'));
const constraintById = new Map(registry.items.map(item => [item.id, item]));

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} failed.\n  Expected: "${expected}"\n  Got:      "${actual}"`);
  }
}

function assert(condition, label) {
  if (!condition) {
    throw new Error(`${label} failed.`);
  }
}

function runStrategyTests() {
  assertEqual(
    clampField('Sentence one. Sentence two.', { clamp_strategy: 'first_sentence', maxChars: 200 }),
    'Sentence one.',
    'first_sentence'
  );

  assertEqual(
    clampField('State — detail follows', { clamp_strategy: 'first_clause', maxChars: 200 }),
    'State',
    'first_clause'
  );

  assertEqual(
    clampField('This is a long label extract test', { clamp_strategy: 'label_extract', labelWordCount: 3 }),
    'This is a',
    'label_extract'
  );

  const obj = { key1: 'First clause — extra', key2: 'Second entry' };
  assertEqual(
    clampField(obj, { clamp_strategy: 'key_value_head', maxLines: 1 }),
    'key1: First clause',
    'key_value_head'
  );

  const arr = ['Alpha entry', 'Beta entry', 'Gamma entry'];
  assertEqual(
    clampField(arr, { clamp_strategy: 'array_head', maxLines: 2, maxChars: 40 }),
    'Alpha entry\nBeta entry',
    'array_head'
  );

  const identity = { title: 'Chief Architect of Versions', detail: 'Longer text' };
  assertEqual(
    clampField(identity, { clamp_strategy: 'identity_only', maxChars: 50 }),
    'Chief Architect of Versions',
    'identity_only'
  );

  const fallback = clampField('', { clamp_strategy: 'first_sentence', clamp_fallback: 'truncate' });
  assertEqual(fallback, '', 'fallback empty string');
}

function runIntegrationTests() {
  // Test: every constraint in the registry produces a non-null result from clampField
  for (const constraint of registry.items) {
    const sample = 'The character maintains the system because the alternative is worse. A cognitive equal oriented toward preservation over reinvention.';
    const result = clampField(sample, constraint);
    assert(typeof result === 'string', `constraint ${constraint.id}: clampField returns string`);
    assert(result.length > 0, `constraint ${constraint.id}: clampField returns non-empty`);
    assert(result.length <= constraint.maxChars + 1, `constraint ${constraint.id}: result within maxChars (got ${result.length}, max ${constraint.maxChars})`);
  }

  // Test: real-world Morrow seed data clamping
  const morrow = {
    role: "Protagonist — The Self-Authored Myth-Maker",
    psychology: "Experiences limits as insults. Ambition as self-expression, not collective vision. Mirror blindness prevents self-diagnosis.",
    question: "Who is Morrow at peak, and what is the hunger he cannot name?",
    dynamic: "Cognitive equals, incompatible orientations",
    definition: "All individual greatness operates on institutional permission. The permission is always conditional, always revocable, and always revoked when the individual's value is exceeded by their cost.",
  };

  const roleConstraint = constraintById.get('entity.role');
  const roleDisplay = clampField(morrow.role, roleConstraint);
  assert(roleDisplay.length > 0, 'entity.role: non-empty display');
  assert(roleDisplay.length <= roleConstraint.maxChars, `entity.role: fits maxChars (got ${roleDisplay.length})`);

  const psychConstraint = constraintById.get('entity.psychology');
  const psychDisplay = clampField(morrow.psychology, psychConstraint);
  assert(psychDisplay.length > 0, 'entity.psychology: non-empty display');
  assert(psychDisplay.endsWith('.') || psychDisplay.endsWith('…'), 'entity.psychology: ends with sentence terminator or ellipsis');

  const questionConstraint = constraintById.get('act.question');
  const questionDisplay = clampField(morrow.question, questionConstraint);
  assert(questionDisplay.length > 0, 'act.question: non-empty display');
  assert(questionDisplay.length <= questionConstraint.maxChars, 'act.question: fits maxChars');

  const dynamicConstraint = constraintById.get('relationship.dynamic');
  const dynamicDisplay = clampField(morrow.dynamic, dynamicConstraint);
  assert(dynamicDisplay.length > 0, 'relationship.dynamic: non-empty display');

  const defConstraint = constraintById.get('principle.definition');
  const defDisplay = clampField(morrow.definition, defConstraint);
  assert(defDisplay.length > 0, 'principle.definition: non-empty display');
  assert(defDisplay.length <= defConstraint.maxChars, `principle.definition: fits maxChars (got ${defDisplay.length})`);

  // Test: first_sentence strategy produces complete sentence
  const firstSentenceResult = clampField('First sentence here. Second sentence follows.', { clamp_strategy: 'first_sentence', maxChars: 200 });
  assertEqual(firstSentenceResult, 'First sentence here.', 'first_sentence extracts complete first sentence');

  // Test: label_extract with very long role
  const longRole = 'The Supreme Chancellor of the United Outer Colonies Military Affairs Committee';
  const labelResult = clampField(longRole, roleConstraint);
  assert(labelResult.length <= roleConstraint.maxChars, 'label_extract: long role fits within limit');
}

runStrategyTests();
console.log('Strategy tests passed.');
runIntegrationTests();
console.log('Integration tests passed.');
console.log('All clamp tests passed.');
