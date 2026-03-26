/**
 * LLM Context Injection Utility
 *
 * Builds field-level semantic guidance from the semantic registry for
 * injection into Claude's system prompt during ontology editing sessions.
 */
import registry from './semantic_registry.json' assert { type: 'json' };
import constraints from './constraint_registry.json' assert { type: 'json' };

const constraintById = new Map(constraints.items.map(item => [item.id, item]));

/**
 * Section-to-contract mapping: which semantic contracts are relevant
 * for each section type being edited.
 */
const SECTION_CONTRACTS = {
  entity: [
    'character.role',
    'character.function_in_narrative',
    'character.psychology',
  ],
  principle: [
    'theme.definition',
    'theme.manifestation',
  ],
  relationship: [
    'relationship.dynamic',
    'relationship.dramatic_function',
  ],
  act: [
    'arc.act',
  ],
  protagonist: [
    'protagonist.core_trait',
    'protagonist.the_flaw',
    'protagonist.the_hunger',
    'protagonist.core_belief.statement',
  ],
  faction: [
    'faction.structural_role',
    'faction.character',
  ],
  set_piece: [
    'set_piece.thematic_argument',
  ],
};

/**
 * Build relevant semantic contracts for a section type.
 *
 * @param {string} sectionType  e.g., "entity", "relationship", "principle"
 * @returns {Array<{ id: string, contract: object }>}
 */
export function getContractsForSection(sectionType) {
  const ids = SECTION_CONTRACTS[sectionType] || [];
  return ids
    .map(id => ({ id, contract: registry.contracts?.[id] }))
    .filter(entry => entry.contract);
}

/**
 * Build relevant constraint info for a section type.
 *
 * @param {string} sectionType
 * @returns {Array<{ id: string, maxChars: number, clamp_strategy: string }>}
 */
export function getConstraintsForSection(sectionType) {
  const constraintMap = {
    entity: ['entity.name', 'entity.role', 'entity.psychology'],
    principle: ['principle.definition'],
    relationship: ['relationship.type', 'relationship.dynamic'],
    act: ['act.title', 'act.question', 'act.tone'],
    expression: ['expression.content'],
  };
  const ids = constraintMap[sectionType] || [];
  return ids
    .map(id => constraintById.get(id))
    .filter(Boolean)
    .map(c => ({ id: c.id, maxChars: c.maxChars, clamp_strategy: c.clamp_strategy }));
}

/**
 * Format a single semantic contract as a readable string for LLM context.
 *
 * @param {string} id
 * @param {object} contract
 * @returns {string}
 */
function formatContract(id, contract) {
  const lines = [
    `  ${id}:`,
    `    Type: ${contract.content_type}`,
    `    Expected form: ${contract.expected_form}`,
    `    Definition: ${contract.semantic_definition}`,
  ];
  if (contract.example) {
    lines.push(`    Example: "${contract.example}"`);
  }
  if (contract.anti_example) {
    lines.push(`    Anti-example: "${contract.anti_example}"`);
    if (contract.anti_example_reason) {
      lines.push(`    Why bad: ${contract.anti_example_reason}`);
    }
  }
  if (contract.length_guidance) {
    const { typical_range, outlier_threshold } = contract.length_guidance;
    lines.push(`    Typical length: ${typical_range[0]}-${typical_range[1]} chars (flag if >${outlier_threshold})`);
  }
  return lines.join('\n');
}

/**
 * Build the full system prompt addendum for a section.
 *
 * @param {string} sectionType  e.g., "entity"
 * @param {object} [exemplar]   Optional exemplar entry to include as reference
 * @returns {string}
 */
export function buildSystemPromptAddendum(sectionType, exemplar = null) {
  const contracts = getContractsForSection(sectionType);
  const constraintInfo = getConstraintsForSection(sectionType);

  if (contracts.length === 0 && constraintInfo.length === 0) return '';

  const sections = [];

  sections.push('When authoring or editing ontology fields, observe the following contracts:');
  sections.push('');

  if (contracts.length > 0) {
    sections.push('SEMANTIC CONTRACTS:');
    contracts.forEach(({ id, contract }) => {
      sections.push(formatContract(id, contract));
    });
    sections.push('');
  }

  if (constraintInfo.length > 0) {
    sections.push('DISPLAY CONSTRAINTS (your canonical text will be automatically clamped):');
    constraintInfo.forEach(c => {
      sections.push(`  ${c.id}: max ${c.maxChars} chars, strategy: ${c.clamp_strategy}`);
    });
    sections.push('');
  }

  sections.push(
    'Write canonical text for full creative fidelity. The display layer is derived',
    'automatically — do not self-truncate or write "summary versions."',
    '',
    'For consistency: if you are adding an entry to an existing array (e.g., a new',
    'character), match the depth, register, and structural pattern of the existing',
    'entries. Specifically, if existing fields are 2-4 sentence behavioral',
    'observations, write yours at the same depth — not a single adjective,',
    'not a full page.'
  );

  if (exemplar) {
    sections.push('');
    sections.push('REFERENCE ENTRY (match this depth and register):');
    sections.push(JSON.stringify(exemplar, null, 2));
  }

  return sections.join('\n');
}
