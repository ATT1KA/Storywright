#!/usr/bin/env node
import { clampField } from '../src/ontology/clamp.js';

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} failed. Expected "${expected}", got "${actual}"`);
  }
}

function runTests() {
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

runTests();
console.log('Clamp strategy tests passed.');
