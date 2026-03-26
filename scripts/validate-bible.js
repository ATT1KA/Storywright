#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runFullValidation } from '../src/ontology/validate.js';

const root = process.cwd();
const templatePath = path.join(root, 'story_bible_template_v2.json');
const registryPath = path.join(root, 'src', 'ontology', 'constraint_registry.json');
const semanticPath = path.join(root, 'src', 'ontology', 'semantic_registry.json');

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
const semanticReg = loadJson(semanticPath, 'semantic_registry');

// ─── Registry parity checks (existing) ───────────────────────────────────────

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

// ─── Content validation (new: --content flag) ─────────────────────────────────

const contentFlag = process.argv.includes('--content');
const contentFile = process.argv.find((arg, i) => process.argv[i - 1] === '--file');

if (contentFlag) {
  const targetPath = contentFile
    ? path.resolve(root, contentFile)
    : path.join(root, 'public', 'data', 'ontologies', 'morrow-doctrine.json');

  const data = loadJson(targetPath, 'content-target');
  if (data) {
    // Detect format: Storywright ontology (has entities array) or Story Bible
    const isOntology = Array.isArray(data.entities) && Array.isArray(data.principles);
    let state = null;

    if (isOntology) {
      state = data;
    } else {
      // Minimal conversion for validation: extract what we can
      console.log('Note: File is not in Storywright ontology format. Running basic validation.');
      state = data;
    }

    if (state) {
      const contracts = semanticReg?.contracts || null;
      const report = runFullValidation(state, contracts);

      console.log(`\nContent validation of ${path.basename(targetPath)}:`);
      console.log(`  Errors:   ${report.summary.errors}`);
      console.log(`  Warnings: ${report.summary.warnings}`);
      console.log(`  Info:     ${report.summary.info}`);

      if (report.errors.length > 0) {
        console.log('\nErrors:');
        report.errors.forEach(e => console.error(`  [${e.code}] ${e.field_path || e.scope}: ${e.message}`));
      }
      if (report.warnings.length > 0) {
        console.log('\nWarnings:');
        report.warnings.forEach(w => console.warn(`  [${w.code}] ${w.field_path || w.scope}: ${w.message}`));
      }
      if (report.info.length > 0) {
        console.log('\nInfo:');
        report.info.forEach(i => console.log(`  [${i.code}] ${i.field_path || i.scope}: ${i.message}`));
      }

      if (report.summary.errors > 0) {
        errors.push(`Content validation found ${report.summary.errors} error(s).`);
      }
    }
  }
}

// ─── Output ───────────────────────────────────────────────────────────────────

if (warnings.length > 0 && !contentFlag) {
  console.warn('Warnings:');
  warnings.forEach(w => console.warn(`  • ${w}`));
}

if (errors.length > 0) {
  if (!contentFlag) {
    console.error('Validation failed:');
    errors.forEach(err => console.error(`  • ${err}`));
  }
  process.exit(1);
}

if (!contentFlag) {
  console.log('story_bible_template_v2.json is in sync with constraint registry.');
}
