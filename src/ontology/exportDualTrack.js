/**
 * Dual-Track Export Utility
 *
 * Transforms the plain-string runtime state into the canonical/display
 * dual-track JSON format described in the V2 specification.
 */
import { deriveDisplayText } from './deriveDisplay.js';

/**
 * Wrap a plain string field into a dual-track object.
 * Returns the original value unchanged if no constraint is registered for the field.
 *
 * @param {string} fieldPath  Generalized field path, e.g. "entity.role"
 * @param {string} value      The canonical string value
 * @returns {{ canonical: string, display: { constraint: string, text: string, clamp_strategy_used: string }, contract: string|null } | string}
 */
function wrapField(fieldPath, value) {
  const display = deriveDisplayText(fieldPath, value);
  if (!display) return value;
  return {
    canonical: value,
    display: {
      constraint: display.constraint,
      text: display.text,
      clamp_strategy_used: display.clamp_strategy_used,
    },
    contract: display.constraint,
  };
}

/**
 * Export the full ontology state in dual-track format.
 *
 * @param {object} state  The runtime ontology state
 * @returns {object}  The dual-track export object
 */
export function exportWithDualTrack(state) {
  if (!state) return state;

  return {
    schema_version: '2.0',
    text_strategy: 'canonical_display',
    meta: {
      title: wrapField('meta.title', state.meta?.title ?? ''),
      subtitle: wrapField('meta.subtitle', state.meta?.subtitle ?? ''),
      coreStatement: wrapField('meta.coreStatement', state.meta?.coreStatement ?? ''),
      narrativeArgument: wrapField('meta.narrativeArgument', state.meta?.narrativeArgument ?? ''),
    },
    principles: (state.principles || []).map(p => ({
      ...p,
      definition: wrapField('principle.definition', p.definition ?? ''),
    })),
    entities: (state.entities || []).map(e => ({
      ...e,
      name: wrapField('entity.name', e.name ?? ''),
      role: wrapField('entity.role', e.role ?? ''),
      psychology: wrapField('entity.psychology', e.psychology ?? ''),
      arc: (e.arc || []).map(beat => ({
        ...beat,
        state: wrapField('arc.state', beat.state ?? ''),
        movement: wrapField('arc.movement', beat.movement ?? ''),
      })),
    })),
    acts: (state.acts || []).map(a => ({
      ...a,
      title: wrapField('act.title', a.title ?? ''),
      question: wrapField('act.question', a.question ?? ''),
      tone: wrapField('act.tone', a.tone ?? ''),
    })),
    relationships: (state.relationships || []).map(r => ({
      ...r,
      type: wrapField('relationship.type', r.type ?? ''),
      dynamic: wrapField('relationship.dynamic', r.dynamic ?? ''),
    })),
    expressions: (state.expressions || []).map(x => ({
      ...x,
      content: wrapField('expression.content', x.content ?? ''),
    })),
  };
}
