/**
 * Edit Mode Discriminator
 *
 * Determines which editing surface a field should use based on
 * the constraint registry's editing_mode field:
 *   - "inline"     → CanonicalInlineEdit (expand-on-focus, short fields)
 *   - "inspector"  → InspectorCanonicalEditor (panel with live preview)
 *   - "structured" → StructuredEditor (object/array fields)
 *
 * Also exposes the semantic contract for a field, used for
 * editor hints and guidance.
 */
import registry from './constraint_registry.json' assert { type: 'json' };
import semanticReg from './semantic_registry.json' assert { type: 'json' };

const constraintById = new Map(registry.items.map(item => [item.id, item]));

/**
 * Map runtime field paths to constraint IDs.
 * Same mapping as constraintRegistry.js — kept in sync.
 */
const FIELD_PATH_TO_CONSTRAINT = {
  'meta.title':               'meta.title',
  'meta.subtitle':            'meta.subtitle',
  'meta.coreStatement':       'meta.core_statement',
  'meta.narrativeArgument':   'meta.narrative_argument',
  'principle.definition':     'principle.definition',
  'entity.name':              'entity.name',
  'entity.role':              'entity.role',
  'entity.psychology':        'entity.psychology',
  'arc.state':                'arc.beat.state',
  'arc.movement':             'arc.beat.detail',
  'act.title':                'act.title',
  'act.question':             'act.question',
  'act.tone':                 'act.tone',
  'relationship.type':        'relationship.type',
  'relationship.dynamic':     'relationship.dynamic',
  'expression.content':       'expression.content',
};

/**
 * Get the editing mode for a field.
 *
 * @param {string} fieldPath  Generalized field path, e.g. "entity.psychology"
 * @returns {"inline"|"inspector"|"structured"}
 */
export function getEditMode(fieldPath) {
  const constraintId = FIELD_PATH_TO_CONSTRAINT[fieldPath];
  if (!constraintId) return 'inline';
  const constraint = constraintById.get(constraintId);
  return constraint?.editing_mode || 'inline';
}

/**
 * Get the semantic contract hint for a field, if one exists.
 * Returns the semantic definition and expected form — useful as
 * editor header hints.
 *
 * @param {string} fieldPath
 * @returns {{ definition: string, expectedForm: string, example: string } | null}
 */
export function getFieldHint(fieldPath) {
  const constraintId = FIELD_PATH_TO_CONSTRAINT[fieldPath];
  if (!constraintId) return null;
  const constraint = constraintById.get(constraintId);
  if (!constraint?.semantic_contract) return null;
  const contract = semanticReg.contracts?.[constraint.semantic_contract];
  if (!contract) return null;
  return {
    definition: contract.semantic_definition,
    expectedForm: contract.expected_form,
    example: contract.example,
  };
}
