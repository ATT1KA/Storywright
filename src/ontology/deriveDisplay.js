/**
 * Display Derivation Utility
 *
 * Derives clamped display text from canonical values using the constraint
 * registry and clamp strategies. Pure functions — no side effects.
 */
import { clampField } from './clamp.js';
import { getConstraintForField, getConstraintById } from './constraintRegistry.js';

/**
 * Derive display text for a single field.
 *
 * @param {string} fieldPath  Generalized field path, e.g. "entity.role"
 * @param {string} canonical  The canonical (full) text value
 * @returns {{ text: string, constraint: string, clamp_strategy_used: string } | null}
 *   Returns null if no constraint is registered for this field path.
 */
export function deriveDisplayText(fieldPath, canonical) {
  const constraint = getConstraintForField(fieldPath);
  if (!constraint) return null;
  const text = clampField(canonical, constraint);
  return {
    text,
    constraint: constraint.id,
    clamp_strategy_used: constraint.clamp_strategy,
  };
}

/**
 * Derive display text using a constraint ID directly.
 *
 * @param {string} constraintId  e.g. "entity.role"
 * @param {string} canonical
 * @returns {{ text: string, constraint: string, clamp_strategy_used: string } | null}
 */
export function deriveDisplayById(constraintId, canonical) {
  const constraint = getConstraintById(constraintId);
  if (!constraint) return null;
  const text = clampField(canonical, constraint);
  return {
    text,
    constraint: constraint.id,
    clamp_strategy_used: constraint.clamp_strategy,
  };
}

/**
 * Derive display text for all dual-track fields in the full ontology state.
 * Returns a flat map keyed by concrete field path (with indices).
 *
 * @param {object} state  The full ontology state object
 * @returns {Map<string, { text: string, constraint: string, clamp_strategy_used: string }>}
 */
export function deriveAllDisplayFields(state) {
  const results = new Map();
  if (!state) return results;

  const put = (key, fieldPath, value) => {
    if (value == null || value === '') return;
    const d = deriveDisplayText(fieldPath, String(value));
    if (d) results.set(key, d);
  };

  // Meta fields
  put('meta.title', 'meta.title', state.meta?.title);
  put('meta.subtitle', 'meta.subtitle', state.meta?.subtitle);
  put('meta.coreStatement', 'meta.coreStatement', state.meta?.coreStatement);
  put('meta.narrativeArgument', 'meta.narrativeArgument', state.meta?.narrativeArgument);

  // Principles
  (state.principles || []).forEach((p, i) => {
    put(`principles[${i}].definition`, 'principle.definition', p.definition);
  });

  // Entities
  (state.entities || []).forEach((e, i) => {
    put(`entities[${i}].name`, 'entity.name', e.name);
    put(`entities[${i}].role`, 'entity.role', e.role);
    put(`entities[${i}].psychology`, 'entity.psychology', e.psychology);
    (e.arc || []).forEach((beat, j) => {
      put(`entities[${i}].arc[${j}].state`, 'arc.state', beat.state);
      put(`entities[${i}].arc[${j}].movement`, 'arc.movement', beat.movement);
    });
  });

  // Acts
  (state.acts || []).forEach((a, i) => {
    put(`acts[${i}].title`, 'act.title', a.title);
    put(`acts[${i}].question`, 'act.question', a.question);
    put(`acts[${i}].tone`, 'act.tone', a.tone);
  });

  // Relationships
  (state.relationships || []).forEach((r, i) => {
    put(`relationships[${i}].type`, 'relationship.type', r.type);
    put(`relationships[${i}].dynamic`, 'relationship.dynamic', r.dynamic);
  });

  // Expressions
  (state.expressions || []).forEach((x, i) => {
    put(`expressions[${i}].content`, 'expression.content', x.content);
  });

  return results;
}
