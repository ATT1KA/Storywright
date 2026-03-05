# Storywright Ontology Format — Motivation & Operating Model

## 1. Problem Context
Storywright must serve two masters simultaneously:

1. **Ground-Truth Story Bible for LLM Coworking**. Authors collaborate with Claude Opus to generate and edit ontologies that capture nuanced thematic arguments, arc logic, and prose-level detail. These canonical entries cannot be truncated or simplified without eroding creative intent.
2. **Sleek, Stable UX for Human Operators**. The existing Storywright UI constrains every surface (Arc Timeline cells, Layer Map cards, Inspector panes, etc.) to tight character budgets to preserve the aesthetic and avoid overflow. Users expect consistent line lengths, uncluttered grids, and zero regressions in layout regardless of ontology size.

Previously, a single string tried to satisfy both needs, forcing brittle ad-hoc truncation during imports and risking UX breakage whenever an LLM added a longer paragraph. We needed a scalable storage primitive that keeps canonical richness intact while guaranteeing deterministic presentation.

## 2. Design Principles
- **Canonical Source of Truth**: Canonical text is never constrained; it holds the full narrative logic for LLMs and human editors.
- **Deterministic Display**: Every UX-visible field is derived from canonical text via shared constraint rules—no hand-authored short summaries that could drift.
- **Single Constraint Registry**: One JSON registry (shared by template and runtime) defines all character/line budgets, keeping UX and data in lockstep.
- **LLM-Free Importer**: All migration and clamping happen via pure functions, so loading files never depends on model calls.
- **Backward Compatibility**: Legacy ontologies with flat strings auto-upgrade on import, so existing workflows keep functioning.
- **Holistic Maintainability**: New surfaces simply add a constraint ID + mapping entry; no bespoke truncation logic sprinkled through the codebase.

## 3. Solution Overview
### Dual-Track Fields
Each UI-exposed text field now stores two views:
- `canonical`: unrestricted prose for creative fidelity and LLM reasoning.
- `display`: `{ constraint, text }`, a deterministic clamp of the canonical content sized to fit the relevant UI slot (e.g., `arc.beat.state`).

### Constraint Registry
- Located at `src/ontology/constraint_registry.json` and mirrored in the template for documentation.
- Specifies `id`, `maxChars`, `maxLines`, and qualitative guidelines for each UI surface.
- Versioned so UI or typography changes can bump the registry and signal downstream updates.

### Deterministic Tooling Pipeline
- **Importer** wraps legacy strings into the dual-track shape, regenerates every `display.text`, and logs truncations in the story’s changelog.
- **Reducer Helpers** (`updateTextField`, `clampText`) ensure any UI edit regenerates `display` immediately, preventing drift between canonical and display entries.
- **Exporter Profiles** output either dual-track JSON (default) or flattened legacy strings for external consumers, with warnings that display summaries will regenerate on the next import.

### Validation & Documentation
- `npm run validate:bible` checks that the template and runtime registry stay in sync and that every constraint ID used in the dual-track map actually exists.
- The template itself documents authoring rules, metadata precedence, and the rationale for canonical/display separation so Claude Opus can align with the process.

## 4. Workflow Impact
| Actor | Experience |
| --- | --- |
| **LLM (Claude Opus)** | Reads and edits canonical text while referencing the constraint registry. Any provided `display.text` is treated as illustrative; importer overwrites it, ensuring deterministic UX output. |
| **Human Authors** | Continue writing rich descriptions in canonical fields. When they want to preview the UI-friendly summary, they run the validation script or load the file into Storywright, which auto-generates the display layer. |
| **Storywright Runtime** | Imports legacy or new schemas seamlessly, renders only `display.text`, and keeps the UI unchanged because the constraint IDs map directly to existing views (Arc Timeline, Layer Map, Inspector, etc.). |

## 5. Future-Proofing & Extensibility
- **Versioning**: Both `schema_version` (data contract) and `constraint_registry.version` (UI contract) are explicit, letting us evolve one without surprising the other.
- **Registry Expansion**: Adding a new surface (e.g., tooltip, report) only requires appending a constraint entry and mapping the corresponding field—no structural upheaval.
- **Validation Hooks**: The validation script can be extended to enforce additional invariants (e.g., max paragraph count) or to ensure exporter profiles stay in sync.
- **Authoring Companion**: The template includes editing guidance so future collaborators—and Claude—understand why display text is derived and how to keep both tracks aligned.

## 6. Why This Works
By separating canonical intent from UX presentation and anchoring both to a shared registry, we reduce the original tension: LLMs retain full expressive power, while Storywright’s UI continues to look impeccable regardless of ontology complexity. Deterministic tooling (no runtime model calls) ensures the system is predictable, auditable, and easy to maintain as the platform scales.
