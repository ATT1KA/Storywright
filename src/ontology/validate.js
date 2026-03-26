/**
 * Three-Tier Validation Engine
 *
 * Tier 1: Field-level contract validation (individual fields vs semantic contracts)
 * Tier 2: Horizontal consistency validation (same-type entries vs each other)
 * Tier 3: Cross-section coherence (referential integrity across the ontology)
 */

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function countSentences(text) {
  if (!text) return 0;
  const matches = text.match(/[.!?](?:\s|$)/g);
  return matches ? matches.length : 0;
}

function hasVerb(text) {
  if (!text || text.length < 10) return false;
  // Heuristic: verbs end in common suffixes, or text is long enough to likely contain one
  return text.length > 30 || /\b(is|are|was|were|has|have|had|does|do|did|can|will|would|could|should|may|might|must|shall|being|been|makes?|takes?|gives?|gets?|keeps?|sees?|knows?|thinks?|finds?|tells?|becomes?|shows?|leaves?|feels?|puts?|brings?|begins?|seems?|helps?|turns?|starts?|runs?|moves?|lives?|plays?|works?|reads?|needs?|means?|develops?|tries?|uses?|provides?|creates?|maintains?|operates?|contains?|produces?|serves?|prevents?|experiences?|establishes?|demonstrates?|reveals?|confirms?|defines?|explains?)\b/i.test(text);
}

function isPlaceholder(text) {
  return /^\[.+\]$/.test((text || '').trim());
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length);
}

function coefficientOfVariation(values) {
  const m = mean(values);
  if (m === 0) return 0;
  return stddev(values) / m;
}

function firstWordIsAdjective(text) {
  if (!text) return false;
  const first = text.trim().split(/\s+/)[0]?.toLowerCase();
  // Common adjective-first patterns (trait lists)
  const adjectives = new Set([
    'smart', 'brilliant', 'cold', 'warm', 'intelligent', 'analytical',
    'driven', 'quiet', 'loud', 'strong', 'weak', 'complex', 'simple',
    'stubborn', 'fierce', 'gentle', 'brave', 'loyal', 'cunning',
    'ruthless', 'compassionate', 'ambitious', 'pragmatic', 'idealistic',
    'charismatic', 'calculating', 'reckless', 'methodical', 'relentless',
  ]);
  return adjectives.has(first);
}

// ─── TIER 1: FIELD-LEVEL CONTRACT VALIDATION ──────────────────────────────────

/**
 * Validate a single field against its semantic contract.
 *
 * @param {string} fieldPath   e.g., "character_definitions.core_cast[3].role"
 * @param {string} canonical   The canonical text value
 * @param {object} contract    The semantic contract from semantic_registry.json
 * @param {object} [options]   { required?: boolean }
 * @returns {Array<{ field_path: string, severity: string, code: string, message: string }>}
 */
export function validateField(fieldPath, canonical, contract, options = {}) {
  const results = [];
  const text = (canonical || '').trim();

  // EMPTY_REQUIRED_FIELD
  if (options.required && text.length === 0) {
    results.push({
      field_path: fieldPath,
      severity: 'error',
      code: 'EMPTY_REQUIRED_FIELD',
      message: `Required field is empty.`,
    });
    return results;
  }

  if (text.length === 0) return results;

  // PLACEHOLDER_NOT_REPLACED
  if (isPlaceholder(text)) {
    results.push({
      field_path: fieldPath,
      severity: 'error',
      code: 'PLACEHOLDER_NOT_REPLACED',
      message: `Field contains a template placeholder: "${text}".`,
    });
    return results;
  }

  if (!contract) return results;

  const { length_guidance, expected_form } = contract;

  // EXCEEDS_OUTLIER_THRESHOLD
  if (length_guidance?.outlier_threshold && text.length > length_guidance.outlier_threshold) {
    results.push({
      field_path: fieldPath,
      severity: 'warning',
      code: 'EXCEEDS_OUTLIER_THRESHOLD',
      message: `Field is ${text.length} chars, exceeding outlier threshold of ${length_guidance.outlier_threshold}.`,
    });
  }

  // BELOW_MINIMUM_RANGE
  if (length_guidance?.typical_range && text.length < length_guidance.typical_range[0]) {
    // Only flag if content doesn't look like a valid short-form entry
    if (text.length > 0 && expected_form !== 'noun_phrase' && expected_form !== 'compound_label') {
      results.push({
        field_path: fieldPath,
        severity: 'warning',
        code: 'BELOW_MINIMUM_RANGE',
        message: `Field is ${text.length} chars, below typical minimum of ${length_guidance.typical_range[0]}.`,
      });
    }
  }

  // FORM_MISMATCH_PARAGRAPH_IN_LABEL
  if ((expected_form === 'noun_phrase' || expected_form === 'compound_label') && countSentences(text) >= 2) {
    results.push({
      field_path: fieldPath,
      severity: 'warning',
      code: 'FORM_MISMATCH_PARAGRAPH_IN_LABEL',
      message: `Expected ${expected_form} but found ${countSentences(text)} sentences. This field should be a title or label, not a paragraph.`,
    });
  }

  // FORM_MISMATCH_LABEL_IN_PARAGRAPH
  if (expected_form === 'declarative_paragraph' && text.length < 30 && !hasVerb(text)) {
    results.push({
      field_path: fieldPath,
      severity: 'warning',
      code: 'FORM_MISMATCH_LABEL_IN_PARAGRAPH',
      message: `Expected declarative_paragraph but field is very short (${text.length} chars) with no apparent verb. Looks like a label, not a paragraph.`,
    });
  }

  return results;
}

// ─── TIER 2: HORIZONTAL CONSISTENCY VALIDATION ────────────────────────────────

/**
 * Validate horizontal consistency across same-type entries.
 *
 * @param {Array<object>} entries       Array of same-type entries (e.g., all characters)
 * @param {string} fieldName            Field to check (e.g., "psychology")
 * @param {string} identityField        Identity field for error messages (e.g., "name")
 * @returns {Array<{ scope: string, field: string, severity: string, code: string, message: string, entries_flagged: string[] }>}
 */
export function validateHorizontalConsistency(entries, fieldName, identityField = 'name') {
  const results = [];
  if (!entries || entries.length < 2) return results;

  const values = entries.map(e => ({
    identity: e[identityField] || e.id || 'unknown',
    text: String(e[fieldName] || '').trim(),
  })).filter(v => v.text.length > 0);

  if (values.length < 2) return results;

  // LENGTH_VARIANCE_HIGH
  const lengths = values.map(v => v.text.length);
  const cov = coefficientOfVariation(lengths);
  if (cov > 1.0) {
    const m = mean(lengths);
    const sd = stddev(lengths);
    const outliers = values.filter(v => Math.abs(v.text.length - m) > 1.5 * sd);
    if (outliers.length > 0) {
      results.push({
        scope: 'entries',
        field: fieldName,
        severity: 'warning',
        code: 'LENGTH_VARIANCE_HIGH',
        message: `High length variance (CoV=${cov.toFixed(2)}) in "${fieldName}" across entries. Mean: ${Math.round(m)} chars, SD: ${Math.round(sd)}.`,
        entries_flagged: outliers.map(o => o.identity),
      });
    }
  }

  // SENTENCE_COUNT_MISMATCH
  const sentCounts = values.map(v => ({ identity: v.identity, count: countSentences(v.text) }));
  const avgSent = mean(sentCounts.map(s => s.count));
  if (avgSent > 0) {
    const outlierSent = sentCounts.filter(s => s.count > avgSent * 4);
    if (outlierSent.length > 0) {
      results.push({
        scope: 'entries',
        field: fieldName,
        severity: 'info',
        code: 'SENTENCE_COUNT_MISMATCH',
        message: `Sentence count outliers in "${fieldName}": average is ${avgSent.toFixed(1)} sentences.`,
        entries_flagged: outlierSent.map(o => o.identity),
      });
    }
  }

  // REGISTER_DRIFT
  const firstWordPatterns = values.map(v => ({
    identity: v.identity,
    isAdjective: firstWordIsAdjective(v.text),
  }));
  const adjectiveCount = firstWordPatterns.filter(p => p.isAdjective).length;
  const declarativeCount = firstWordPatterns.length - adjectiveCount;
  // Flag if minority pattern exists (at least 1 but less than half)
  if (adjectiveCount > 0 && adjectiveCount < declarativeCount) {
    results.push({
      scope: 'entries',
      field: fieldName,
      severity: 'info',
      code: 'REGISTER_DRIFT',
      message: `Most "${fieldName}" entries start with a declarative statement, but some start with adjective lists.`,
      entries_flagged: firstWordPatterns.filter(p => p.isAdjective).map(p => p.identity),
    });
  } else if (declarativeCount > 0 && declarativeCount < adjectiveCount) {
    results.push({
      scope: 'entries',
      field: fieldName,
      severity: 'info',
      code: 'REGISTER_DRIFT',
      message: `Most "${fieldName}" entries start with adjective lists, but some start with declarative statements.`,
      entries_flagged: firstWordPatterns.filter(p => !p.isAdjective).map(p => p.identity),
    });
  }

  return results;
}

/**
 * Check field presence inconsistency across entries.
 *
 * @param {Array<object>} entries
 * @param {string} fieldName        The optional field to check
 * @param {string} identityField
 * @returns {Array}
 */
export function validateFieldPresence(entries, fieldName, identityField = 'name') {
  const results = [];
  if (!entries || entries.length < 3) return results;

  const present = entries.filter(e => {
    const val = e[fieldName];
    return val != null && String(val).trim().length > 0;
  });
  const ratio = present.length / entries.length;

  if (ratio > 0.2 && ratio < 0.8) {
    const missing = entries.filter(e => {
      const val = e[fieldName];
      return val == null || String(val).trim().length === 0;
    });
    results.push({
      scope: 'entries',
      field: fieldName,
      severity: 'warning',
      code: 'FIELD_PRESENCE_INCONSISTENT',
      message: `"${fieldName}" appears on ${present.length} of ${entries.length} entries (${Math.round(ratio * 100)}%). Is this intentional?`,
      entries_flagged: missing.map(e => e[identityField] || e.id || 'unknown'),
    });
  }

  return results;
}

// ─── TIER 3: CROSS-SECTION COHERENCE ──────────────────────────────────────────

/**
 * Validate cross-section coherence across the full ontology.
 *
 * @param {object} state  The full ontology state
 * @returns {Array<{ scope: string, severity: string, code: string, message: string, entries_flagged?: string[] }>}
 */
export function validateCoherence(state) {
  const results = [];
  if (!state) return results;

  const entities = state.entities || [];
  const principles = state.principles || [];
  const relationships = state.relationships || [];
  const acts = state.acts || [];

  const entityIds = new Set(entities.map(e => e.id));

  // CHARACTER_WITHOUT_FUNCTION
  const characters = entities.filter(e => e.type === 'character');
  characters.forEach(c => {
    const hasRole = c.role && c.role.trim().length > 0;
    const hasPsych = c.psychology && c.psychology.trim().length > 0;
    if (!hasRole && !hasPsych) {
      results.push({
        scope: 'entities',
        severity: 'warning',
        code: 'CHARACTER_WITHOUT_FUNCTION',
        message: `Character "${c.name}" has no role or psychology defined.`,
        entries_flagged: [c.name],
      });
    }
  });

  // THEME_UNMANIFESTED
  const allEntityText = entities.map(e => `${e.name} ${e.role} ${e.psychology}`).join(' ').toLowerCase();
  principles.forEach(p => {
    const defWords = (p.definition || '').toLowerCase().split(/\s+/).filter(w => w.length > 4);
    // Check if any entity references this principle
    const servingEntities = entities.filter(e => e.servesPrinciples?.includes(p.id));
    if (servingEntities.length === 0 && defWords.length > 0) {
      results.push({
        scope: 'principles',
        severity: 'warning',
        code: 'THEME_UNMANIFESTED',
        message: `Principle "${p.name}" is not served by any entity.`,
        entries_flagged: [p.name],
      });
    }
  });

  // FACTION_ORPHANED
  const factions = entities.filter(e => e.type === 'faction');
  factions.forEach(f => {
    const hasRelationship = relationships.some(r => r.source === f.id || r.target === f.id);
    if (!hasRelationship) {
      results.push({
        scope: 'entities',
        severity: 'info',
        code: 'FACTION_ORPHANED',
        message: `Faction "${f.name}" has no relationships, suggesting it may not be connected to the narrative structure.`,
        entries_flagged: [f.name],
      });
    }
  });

  // ARC_MOVEMENT_COUNT_MISMATCH
  const actCount = acts.length;
  if (actCount > 0) {
    entities.forEach(e => {
      const arcLen = e.arc?.length || 0;
      if (arcLen > 0 && arcLen > actCount * 2) {
        results.push({
          scope: 'entities',
          severity: 'warning',
          code: 'ARC_MOVEMENT_COUNT_MISMATCH',
          message: `Entity "${e.name}" has ${arcLen} arc beats but only ${actCount} acts. Some beats may be redundant.`,
          entries_flagged: [e.name],
        });
      }
    });
  }

  // RELATIONSHIP_MISSING_CHARACTER
  relationships.forEach(r => {
    if (!entityIds.has(r.source)) {
      results.push({
        scope: 'relationships',
        severity: 'error',
        code: 'RELATIONSHIP_MISSING_CHARACTER',
        message: `Relationship "${r.type || r.id}" references source "${r.source}" which is not in entities.`,
        entries_flagged: [r.id],
      });
    }
    if (!entityIds.has(r.target)) {
      results.push({
        scope: 'relationships',
        severity: 'error',
        code: 'RELATIONSHIP_MISSING_CHARACTER',
        message: `Relationship "${r.type || r.id}" references target "${r.target}" which is not in entities.`,
        entries_flagged: [r.id],
      });
    }
  });

  // SHADOW_TRIGGER_MISSING_CHARACTER (checks shadow references non-existent principle)
  const principleIds = new Set(principles.map(p => p.id));
  entities.forEach(e => {
    if (!e.shadow) return;
    Object.entries(e.shadow).forEach(([quality, principleId]) => {
      if (!principleIds.has(principleId)) {
        results.push({
          scope: 'entities',
          severity: 'error',
          code: 'SHADOW_TRIGGER_MISSING_CHARACTER',
          message: `Entity "${e.name}" shadow quality "${quality}" references principle "${principleId}" which does not exist.`,
          entries_flagged: [e.name],
        });
      }
    });
  });

  return results;
}

// ─── ORCHESTRATOR ─────────────────────────────────────────────────────────────

/**
 * Run full three-tier validation on an ontology state.
 *
 * @param {object} state            The full ontology state
 * @param {object} [semanticContracts]  The contracts object from semantic_registry.json (optional)
 * @returns {{ errors: object[], warnings: object[], info: object[], summary: { errors: number, warnings: number, info: number } }}
 */
export function runFullValidation(state, semanticContracts = null) {
  const allResults = [];

  // ── Tier 1: Field-level ──
  if (semanticContracts) {
    // Validate entity fields against contracts
    const entities = state.entities || [];
    entities.forEach((e, i) => {
      const path = `entities[${i}]`;
      if (semanticContracts['character.role']) {
        allResults.push(...validateField(`${path}.role`, e.role, semanticContracts['character.role']));
      }
      if (semanticContracts['character.psychology']) {
        allResults.push(...validateField(`${path}.psychology`, e.psychology, semanticContracts['character.psychology']));
      }
    });

    // Validate principle definitions
    (state.principles || []).forEach((p, i) => {
      if (semanticContracts['theme.definition']) {
        allResults.push(...validateField(`principles[${i}].definition`, p.definition, semanticContracts['theme.definition']));
      }
    });

    // Validate relationship dynamics
    (state.relationships || []).forEach((r, i) => {
      if (semanticContracts['relationship.dynamic']) {
        allResults.push(...validateField(`relationships[${i}].dynamic`, r.dynamic, semanticContracts['relationship.dynamic']));
      }
    });

    // Validate act questions
    (state.acts || []).forEach((a, i) => {
      if (semanticContracts['arc.act']) {
        allResults.push(...validateField(`acts[${i}].question`, a.question, semanticContracts['arc.act']));
      }
    });

    // Validate expression content
    (state.expressions || []).forEach((x, i) => {
      allResults.push(...validateField(`expressions[${i}].content`, x.content, null, { required: true }));
    });
  }

  // Basic field checks even without contracts (placeholders, empty required)
  (state.entities || []).forEach((e, i) => {
    allResults.push(...validateField(`entities[${i}].name`, e.name, null, { required: true }));
    allResults.push(...validateField(`entities[${i}].role`, e.role, null));
    allResults.push(...validateField(`entities[${i}].psychology`, e.psychology, null));
  });
  (state.principles || []).forEach((p, i) => {
    allResults.push(...validateField(`principles[${i}].name`, p.name, null, { required: true }));
    allResults.push(...validateField(`principles[${i}].definition`, p.definition, null));
  });

  // ── Tier 2: Horizontal consistency ──
  const characters = (state.entities || []).filter(e => e.type === 'character');
  if (characters.length >= 2) {
    allResults.push(...validateHorizontalConsistency(characters, 'psychology', 'name'));
    allResults.push(...validateHorizontalConsistency(characters, 'role', 'name'));
    allResults.push(...validateFieldPresence(characters, 'psychology', 'name'));
    allResults.push(...validateFieldPresence(characters, 'shadow', 'name'));
  }

  const allEntities = state.entities || [];
  if (allEntities.length >= 3) {
    allResults.push(...validateFieldPresence(allEntities, 'arc', 'name'));
  }

  // ── Tier 3: Cross-section coherence ──
  allResults.push(...validateCoherence(state));

  // ── Collate ──
  const errors = allResults.filter(r => r.severity === 'error');
  const warnings = allResults.filter(r => r.severity === 'warning');
  const info = allResults.filter(r => r.severity === 'info');

  return {
    errors,
    warnings,
    info,
    summary: { errors: errors.length, warnings: warnings.length, info: info.length },
  };
}
