#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  validateField,
  validateHorizontalConsistency,
  validateFieldPresence,
  validateCoherence,
  runFullValidation,
} from '../src/ontology/validate.js';

const root = path.resolve(import.meta.dirname, '..');
const semanticReg = JSON.parse(readFileSync(path.join(root, 'src', 'ontology', 'semantic_registry.json'), 'utf8'));

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  assert(actual === expected, `${label} — expected ${expected}, got ${actual}`);
}

// ─── Tier 1: Field-level validation ───────────────────────────────────────────

console.log('Tier 1: Field-level validation');

// EMPTY_REQUIRED_FIELD
{
  const results = validateField('test.name', '', null, { required: true });
  assert(results.length === 1, 'empty required field produces 1 result');
  assertEqual(results[0]?.code, 'EMPTY_REQUIRED_FIELD', 'code is EMPTY_REQUIRED_FIELD');
  assertEqual(results[0]?.severity, 'error', 'severity is error');
}

// PLACEHOLDER_NOT_REPLACED
{
  const results = validateField('test.field', '[PLACEHOLDER TEXT]', null);
  assert(results.length === 1, 'placeholder produces 1 result');
  assertEqual(results[0]?.code, 'PLACEHOLDER_NOT_REPLACED', 'code is PLACEHOLDER_NOT_REPLACED');
  assertEqual(results[0]?.severity, 'error', 'severity is error');
}

// EXCEEDS_OUTLIER_THRESHOLD
{
  const contract = { length_guidance: { typical_range: [20, 100], outlier_threshold: 50 }, expected_form: 'declarative_sentence' };
  const longText = 'A'.repeat(60);
  const results = validateField('test.field', longText, contract);
  assert(results.some(r => r.code === 'EXCEEDS_OUTLIER_THRESHOLD'), 'outlier threshold flagged');
}

// BELOW_MINIMUM_RANGE
{
  const contract = { length_guidance: { typical_range: [50, 200], outlier_threshold: 300 }, expected_form: 'declarative_paragraph' };
  const results = validateField('test.field', 'Short.', contract);
  assert(results.some(r => r.code === 'BELOW_MINIMUM_RANGE'), 'below minimum range flagged');
}

// FORM_MISMATCH_PARAGRAPH_IN_LABEL
{
  const contract = { expected_form: 'noun_phrase', length_guidance: { typical_range: [5, 60], outlier_threshold: 100 } };
  const results = validateField('test.field', 'This is a sentence. And another sentence. And a third.', contract);
  assert(results.some(r => r.code === 'FORM_MISMATCH_PARAGRAPH_IN_LABEL'), 'paragraph in label field flagged');
}

// FORM_MISMATCH_LABEL_IN_PARAGRAPH
{
  const contract = { expected_form: 'declarative_paragraph', length_guidance: { typical_range: [80, 400], outlier_threshold: 600 } };
  const results = validateField('test.field', 'Smart, cold', contract);
  assert(results.some(r => r.code === 'FORM_MISMATCH_LABEL_IN_PARAGRAPH'), 'label in paragraph field flagged');
}

// Valid content produces no results
{
  const contract = semanticReg.contracts['character.psychology'];
  const validText = 'Caine maintains the system because the alternative is worse. A cognitive equal oriented toward preservation over reinvention.';
  const results = validateField('test.psychology', validText, contract);
  assert(results.length === 0, 'valid psychology produces no validation errors');
}

// ─── Tier 2: Horizontal consistency ───────────────────────────────────────────

console.log('Tier 2: Horizontal consistency');

// LENGTH_VARIANCE_HIGH
{
  const entries = [
    { name: 'A', psychology: 'Short text here.' },
    { name: 'B', psychology: 'A'.repeat(1000) },
    { name: 'C', psychology: 'Another short text.' },
    { name: 'D', psychology: 'One more short text.' },
  ];
  const results = validateHorizontalConsistency(entries, 'psychology', 'name');
  assert(results.some(r => r.code === 'LENGTH_VARIANCE_HIGH'), 'high variance flagged');
}

// Consistent entries produce no LENGTH_VARIANCE_HIGH
{
  const entries = [
    { name: 'A', psychology: 'About fifty characters of behavioral observation here.' },
    { name: 'B', psychology: 'Roughly similar length behavioral observation text.' },
    { name: 'C', psychology: 'Another comparable length behavioral description.' },
  ];
  const results = validateHorizontalConsistency(entries, 'psychology', 'name');
  assert(!results.some(r => r.code === 'LENGTH_VARIANCE_HIGH'), 'consistent lengths not flagged');
}

// FIELD_PRESENCE_INCONSISTENT
{
  const entries = [
    { name: 'A', shadow: { dep: 'p1' } },
    { name: 'B', shadow: null },
    { name: 'C', shadow: { dep: 'p2' } },
    { name: 'D', shadow: null },
    { name: 'E', shadow: null },
  ];
  const results = validateFieldPresence(entries, 'shadow', 'name');
  assert(results.some(r => r.code === 'FIELD_PRESENCE_INCONSISTENT'), 'inconsistent field presence flagged');
}

// REGISTER_DRIFT
{
  const entries = [
    { name: 'A', role: 'Maintains the system through force.' },
    { name: 'B', role: 'Creates new pathways for governance.' },
    { name: 'C', role: 'Stubborn and driven by ambition.' },
  ];
  const results = validateHorizontalConsistency(entries, 'role', 'name');
  // "Stubborn" starts with adjective, others start with verbs
  assert(results.some(r => r.code === 'REGISTER_DRIFT'), 'register drift flagged');
}

// ─── Tier 3: Cross-section coherence ──────────────────────────────────────────

console.log('Tier 3: Cross-section coherence');

// RELATIONSHIP_MISSING_CHARACTER
{
  const state = {
    entities: [{ id: 'e1', name: 'Alpha', type: 'character', role: 'Test', psychology: 'Test', servesPrinciples: [] }],
    principles: [],
    relationships: [{ id: 'r1', source: 'e1', target: 'e99', type: 'Test', dynamic: 'Test', tension: 0.5 }],
    acts: [],
    expressions: [],
  };
  const results = validateCoherence(state);
  assert(results.some(r => r.code === 'RELATIONSHIP_MISSING_CHARACTER'), 'missing relationship target flagged');
}

// CHARACTER_WITHOUT_FUNCTION
{
  const state = {
    entities: [{ id: 'e1', name: 'Empty', type: 'character', role: '', psychology: '', servesPrinciples: [] }],
    principles: [],
    relationships: [],
    acts: [],
    expressions: [],
  };
  const results = validateCoherence(state);
  assert(results.some(r => r.code === 'CHARACTER_WITHOUT_FUNCTION'), 'character without function flagged');
}

// THEME_UNMANIFESTED
{
  const state = {
    entities: [{ id: 'e1', name: 'Char', type: 'character', role: 'Test', psychology: 'Test', servesPrinciples: [] }],
    principles: [{ id: 'p1', name: 'Orphan Theme', definition: 'No one serves this.' }],
    relationships: [],
    acts: [],
    expressions: [],
  };
  const results = validateCoherence(state);
  assert(results.some(r => r.code === 'THEME_UNMANIFESTED'), 'unmanifested theme flagged');
}

// SHADOW_TRIGGER_MISSING_CHARACTER (actually missing principle)
{
  const state = {
    entities: [{ id: 'e1', name: 'Char', type: 'character', role: 'Test', psychology: 'Test', servesPrinciples: [], shadow: { dep: 'p999' } }],
    principles: [{ id: 'p1', name: 'Real', definition: 'Exists.' }],
    relationships: [],
    acts: [],
    expressions: [],
  };
  const results = validateCoherence(state);
  assert(results.some(r => r.code === 'SHADOW_TRIGGER_MISSING_CHARACTER'), 'shadow with missing principle flagged');
}

// ─── Full orchestrator with Morrow seed data ─────────────────────────────────

console.log('Orchestrator: Morrow seed data');

{
  const morrowPath = path.join(root, 'public', 'data', 'ontologies', 'morrow-doctrine.json');
  let morrow;
  try {
    morrow = JSON.parse(readFileSync(morrowPath, 'utf8'));
  } catch {
    console.log('  Skipping: morrow-doctrine.json not found');
  }

  if (morrow) {
    const isOntology = Array.isArray(morrow.entities) && Array.isArray(morrow.principles);
    if (isOntology) {
      const report = runFullValidation(morrow, semanticReg.contracts);
      assert(report.summary.errors === 0, `Morrow seed: 0 errors (got ${report.summary.errors})`);
      console.log(`  Morrow: ${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.info} info`);
    } else {
      console.log('  Skipping: morrow-doctrine.json is not in ontology format');
    }
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
console.log('All validation tests passed.');
