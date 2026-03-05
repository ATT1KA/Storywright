#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const templatePath = path.join(root, 'story_bible_template_v2.json');
const registryPath = path.join(root, 'src', 'ontology', 'constraint_registry.json');

const errors = [];
const warnings = [];

function loadJson(filePath, label) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    errors.push(`${label}: failed to read/parse (${err.message})`);
    return null;
  }
}

const template = loadJson(templatePath, 'template');
const registry = loadJson(registryPath, 'registry');

if (template && registry) {
  const templateRegistry = template.constraint_registry;
  if (!templateRegistry) {
    errors.push('template: missing constraint_registry section');
  } else {
    if (templateRegistry.version !== registry.version) {
      errors.push(`constraint registry version mismatch (template=${templateRegistry.version}, runtime=${registry.version})`);
    }

    const templateItems = (templateRegistry.items || []).map(item => item.id);
    const runtimeItems = (registry.items || []).map(item => item.id);

    const missingInTemplate = runtimeItems.filter(id => !templateItems.includes(id));
    const missingInRuntime = templateItems.filter(id => !runtimeItems.includes(id));

    if (missingInTemplate.length > 0) {
      errors.push(`registry items missing in template: ${missingInTemplate.join(', ')}`);
    }
    if (missingInRuntime.length > 0) {
      errors.push(`template lists constraints not found in runtime registry: ${missingInRuntime.join(', ')}`);
    }
  }

  const map = template.dual_track_field_map || {};
  const mapConstraintIds = new Set(Object.values(map));
  mapConstraintIds.forEach(id => {
    if (!registry.items?.some(item => item.id === id)) {
      errors.push(`dual_track_field_map references unknown constraint id: ${id}`);
    }
  });

  const registryIdSet = new Set((registry.items || []).map(item => item.id));
  const unusedIds = [...registryIdSet].filter(id => !mapConstraintIds.has(id));
  if (unusedIds.length > 0) {
    warnings.push(`constraint ids not referenced by dual_track_field_map: ${unusedIds.join(', ')}`);
  }

  if (template.schema_version !== '2.0') {
    warnings.push(`schema_version is ${template.schema_version}; expected 2.0`);
  }
}

if (warnings.length > 0) {
  console.warn('Warnings:');
  warnings.forEach(w => console.warn(`  • ${w}`));
}

if (errors.length > 0) {
  console.error('Validation failed:');
  errors.forEach(err => console.error(`  • ${err}`));
  process.exit(1);
}

console.log('story_bible_template_v2.json is in sync with constraint registry.');
