/**
 * Constraint Registry Accessor
 *
 * Provides lookup of display constraints by ID and by runtime field path.
 * Maps runtime ontology field paths to constraint registry entries.
 */
import registry from './constraint_registry.json' assert { type: 'json' };

const byId = new Map(registry.items.map(item => [item.id, item]));

/**
 * Maps runtime field paths (as used in the app state) to constraint IDs.
 * Stripped from the template's dual_track_field_map (without the "ontology." prefix)
 * and with array brackets generalized.
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

const fieldPathToConstraint = new Map(
  Object.entries(FIELD_PATH_TO_CONSTRAINT).map(([fp, cid]) => [fp, byId.get(cid)])
);

/**
 * Look up a constraint entry by its ID (e.g., "entity.role").
 * @param {string} id
 * @returns {object|null}
 */
export function getConstraintById(id) {
  return byId.get(id) || null;
}

/**
 * Look up a constraint entry by a runtime field path (e.g., "entity.role").
 * The field path uses the generalized form: "entity.role", not "entities[3].role".
 * @param {string} fieldPath
 * @returns {object|null}
 */
export function getConstraintForField(fieldPath) {
  return fieldPathToConstraint.get(fieldPath) || null;
}

/**
 * Return all constraint items.
 * @returns {object[]}
 */
export function getAllConstraints() {
  return registry.items;
}

/**
 * Return the registry version string.
 * @returns {string}
 */
export function getRegistryVersion() {
  return registry.version;
}

/**
 * Return the full mapping of field paths to constraint IDs.
 * @returns {Record<string, string>}
 */
export function getFieldPathMap() {
  return { ...FIELD_PATH_TO_CONSTRAINT };
}
