import { useState, useCallback, useMemo, useEffect, useRef, useReducer, createContext, useContext } from "react";
import { deriveDisplayText, deriveAllDisplayFields } from "./src/ontology/deriveDisplay.js";
import { exportWithDualTrack } from "./src/ontology/exportDualTrack.js";
import { getEditMode, getFieldHint } from "./src/ontology/editMode.js";
import { runFullValidation } from "./src/ontology/validate.js";
import { buildSystemPromptAddendum } from "./src/ontology/llmContext.js";

// ═══════════════════════════════════════════════════════════════════════════════
// STORYWRIGHT v0.5 — High-Contrast Tactile Writing Environment + Dark Mode
// ═══════════════════════════════════════════════════════════════════════════════

// ─── THEME SYSTEM ───────────────────────────────────────────────────────────

const LIGHT = {
  mode: "light",
  bgCanvas:     "#FAFAFA",
  bgPane:       "#FFFFFF",
  textUi:       "#404040",
  textUiStrong: "#171717",
  textWork:     "#000000",
  borderBezel:  "#E5E5E5",
  textUiLight:  "#737373",
  textUiGhost:  "#A3A3A3",
  bgHover:      "#F5F5F5",
  bgActive:     "#EFEFEF",
  bgInputFocus: "#FFFFFF",
  // node-specific
  nodeFill:     "#FFFFFF",
  nodeStroke:   "#D4D4D4",
  nodeStrokeW:  1.5,
  labelBg:      "#FAFAFA",
  // accents
  blue:   "#2563EB",
  red:    "#DC2626",
  green:  "#059669",
  yellow: "#D97706",
  blueTint:   "rgba(37, 99, 235, 0.06)",
  redTint:    "rgba(220, 38, 38, 0.06)",
  greenTint:  "rgba(5, 150, 105, 0.06)",
  yellowTint: "rgba(217, 119, 6, 0.06)",
  // acrylic
  acrylic:       "rgba(255, 255, 255, 0.85)",
  acrylicShadow: "0 8px 24px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.06)",
  acrylicBlur:   "blur(12px)",
  // tension
  tension: v => `hsl(${30 - v * 30}, ${50 + v * 40}%, ${48 - v * 12}%)`,
};

const DARK = {
  mode: "dark",
  bgCanvas:     "#0F0F0F",
  bgPane:       "#1A1A1A",
  textUi:       "#A0A0A0",
  textUiStrong: "#E8E8E8",
  textWork:     "#F2F2F2",
  borderBezel:  "#2A2A2A",
  textUiLight:  "#707070",
  textUiGhost:  "#4A4A4A",
  bgHover:      "#222222",
  bgActive:     "#2A2A2A",
  bgInputFocus: "#1A1A1A",
  nodeFill:     "#1E1E1E",
  nodeStroke:   "#3A3A3A",
  nodeStrokeW:  1.5,
  labelBg:      "#0F0F0F",
  blue:   "#5B9AFF",
  red:    "#F06060",
  green:  "#34D399",
  yellow: "#F5A623",
  blueTint:   "rgba(91, 154, 255, 0.10)",
  redTint:    "rgba(240, 96, 96, 0.10)",
  greenTint:  "rgba(52, 211, 153, 0.10)",
  yellowTint: "rgba(245, 166, 35, 0.10)",
  acrylic:       "rgba(26, 26, 26, 0.88)",
  acrylicShadow: "0 8px 24px rgba(0,0,0,0.32), 0 0 0 1px rgba(255,255,255,0.06)",
  acrylicBlur:   "blur(12px)",
  tension: v => `hsl(${30 - v * 30}, ${50 + v * 30}%, ${55 + v * 10}%)`,
};

const ThemeCtx = createContext(LIGHT);
const useT = () => useContext(ThemeCtx);

const PORT_COLOR_K = { universal: "yellow", structural: "blue", cultural: "red", linguistic: "red" };
const TYPE_ICON = { character: "◉", faction: "⬡", location: "◇", instrument: "⬢" };

const STORAGE_KEY = "STORYWRIGHT_PROJECTS_V1";
const STORAGE_LIMIT = 10;

const safeJsonParse = (value, fallback) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const readStoredProjects = () => {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const parsed = safeJsonParse(raw, []);
  return Array.isArray(parsed) ? parsed : [];
};

const cloneState = (state) => safeJsonParse(JSON.stringify(state || {}), {});

const formatTimestampLabel = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return date.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const deriveProjectName = (title, date = new Date()) => {
  const base = (title || "Untitled Project").trim() || "Untitled Project";
  return `${base} — ${formatTimestampLabel(date)}`;
};

function useStoredProjects() {
  const [projects, setProjects] = useState(() => readStoredProjects());

  const persist = useCallback((updater) => {
    setProjects(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }, []);

  const saveProject = useCallback((payload) => {
    const record = {
      id: `proj_${uid()}`,
      savedAt: Date.now(),
      ...payload,
    };
    persist(prev => [record, ...prev].slice(0, STORAGE_LIMIT));
    return record;
  }, [persist]);

  const deleteProject = useCallback((id) => {
    persist(prev => prev.filter(p => p.id !== id));
  }, [persist]);

  const refreshProjects = useCallback(() => {
    setProjects(readStoredProjects());
  }, []);

  return { projects, saveProject, deleteProject, refreshProjects };
}

/** Wrap at word boundaries; hyphenated compounds break at hyphen (no mid-word splits). */
const wrapText = (str, maxChars) => {
  if (!str) return [""];
  if (str.length <= maxChars) return [str];
  const tokens = [];
  for (const w of str.split(/\s+/)) {
    if (w.length <= maxChars) {
      tokens.push(w);
    } else if (w.includes("-")) {
      w.split("-").forEach(p => p && tokens.push(p));
    } else {
      for (let i = 0; i < w.length; i += maxChars) tokens.push(w.slice(i, i + maxChars));
    }
  }
  const lines = [];
  let line = "";
  for (const t of tokens) {
    const toAdd = line ? " " + t : t;
    if (line.length + toAdd.length <= maxChars) {
      line += toAdd;
    } else {
      if (line) lines.push(line.trimEnd());
      line = t;
    }
  }
  if (line) lines.push(line.trimEnd());
  return lines.length ? lines : [str];
};

// ─── DATA REDUCER ────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 8);

function storyReducer(state, action) {
  switch (action.type) {
    case "UPDATE_PRINCIPLE":
      return { ...state, principles: state.principles.map(p => p.id === action.id ? { ...p, ...action.data } : p) };
    case "UPDATE_ENTITY":
      return { ...state, entities: state.entities.map(e => e.id === action.id ? { ...e, ...action.data } : e) };
    case "UPDATE_RELATIONSHIP":
      return { ...state, relationships: state.relationships.map(r => r.id === action.id ? { ...r, ...action.data } : r) };
    case "UPDATE_EXPRESSION":
      return { ...state, expressions: state.expressions.map(x => x.id === action.id ? { ...x, ...action.data } : x) };
    case "UPDATE_ACT":
      return { ...state, acts: state.acts.map(a => a.number === action.number ? { ...a, ...action.data } : a) };
    case "ADD_PRINCIPLE":
      return { ...state, principles: [...state.principles, { id: `p_${uid()}`, name: action.name || "New Principle", definition: action.definition || "", portability: "universal", redundancy: 1 }] };
    case "ADD_ENTITY":
      return { ...state, entities: [...state.entities, { id: `e_${uid()}`, name: action.name || "New Entity", type: action.entityType || "character", layer: "institutional", role: action.role || "", psychology: action.psychology || "", servesPrinciples: action.servesPrinciples || [], arc: action.arc || [], shadow: null }] };
    case "ADD_RELATIONSHIP":
      return { ...state, relationships: [...state.relationships, { id: `r_${uid()}`, source: action.source, target: action.target, type: action.relType || "", dynamic: action.dynamic || "", tension: action.tension || 0.5, trajectory: action.trajectory || "" }] };
    case "ADD_EXPRESSION":
      return { ...state, expressions: [...state.expressions, { id: `x_${uid()}`, type: action.exprType || "dialogue", content: action.content || "", character: action.character || "", act: action.act || null, servesPrinciples: action.servesPrinciples || [], servesEntity: action.character || "", portability: action.portability || "linguistic", redundancy: action.redundancy || 1, note: action.note || "" }] };
    case "ADD_ACT": {
      const num = (state.acts.length > 0 ? Math.max(...state.acts.map(a => a.number)) : 0) + 1;
      return { ...state, acts: [...state.acts, { number: num, title: action.title || `Act ${num}`, episodes: "", tone: action.tone || "", question: action.question || "" }] };
    }
    case "REMOVE_ENTITY":
      return { ...state, entities: state.entities.filter(e => e.id !== action.id), relationships: state.relationships.filter(r => r.source !== action.id && r.target !== action.id), expressions: state.expressions.filter(x => x.character !== action.id && x.servesEntity !== action.id) };
    case "REMOVE_PRINCIPLE":
      return { ...state, principles: state.principles.filter(p => p.id !== action.id), entities: state.entities.map(e => ({ ...e, servesPrinciples: e.servesPrinciples.filter(pid => pid !== action.id) })), expressions: state.expressions.map(x => ({ ...x, servesPrinciples: x.servesPrinciples.filter(pid => pid !== action.id) })) };
    case "REMOVE_RELATIONSHIP":
      return { ...state, relationships: state.relationships.filter(r => r.id !== action.id) };
    case "REMOVE_EXPRESSION":
      return { ...state, expressions: state.expressions.filter(x => x.id !== action.id) };
    case "TOGGLE_PRINCIPLE_LINK":
      return { ...state, entities: state.entities.map(e => {
        if (e.id !== action.entityId) return e;
        const has = e.servesPrinciples.includes(action.principleId);
        return { ...e, servesPrinciples: has ? e.servesPrinciples.filter(p => p !== action.principleId) : [...e.servesPrinciples, action.principleId] };
      })};
    case "UPDATE_META":
      return { ...state, meta: { ...state.meta, ...action.data } };
    case "BATCH_UPDATE": {
      let s = state;
      for (const op of action.operations) s = storyReducer(s, op);
      return s;
    }
    case "LOAD_STATE":
      return action.state;
    default: return state;
  }
}

function undoReducer(state, action) {
  if (action.type === "UNDO") {
    if (state.past.length === 0) return state;
    return { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future] };
  }
  if (action.type === "REDO") {
    if (state.future.length === 0) return state;
    return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) };
  }
  const newPresent = storyReducer(state.present, action);
  if (newPresent === state.present) return state;
  return { past: [...state.past.slice(-50), state.present], present: newPresent, future: [] };
}

// ─── EMPTY STATE & ONTOLOGY CONFIG ───────────────────────────────────────────

const EMPTY = {
  meta: { title: "", subtitle: "", coreStatement: "", narrativeArgument: "" },
  principles: [], entities: [], relationships: [], acts: [], expressions: [],
};

const DEFAULT_ONTOLOGY_PATH = "/data/ontologies/morrow-doctrine.json";

/** Extract canonical string from a dual-track field object, or pass strings through. */
function unwrapCanonical(value) {
  if (value == null) return value;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value.canonical !== undefined) return String(value.canonical);
  return String(value);
}

/** Unwrap an ontology_payload whose text fields are dual-track objects into plain-string ontology state. */
function unwrapOntologyPayload(payload) {
  const uc = unwrapCanonical;
  return {
    meta: {
      title: uc(payload.meta?.title) ?? "",
      subtitle: uc(payload.meta?.subtitle) ?? "",
      coreStatement: uc(payload.meta?.coreStatement ?? payload.meta?.core_statement) ?? "",
      narrativeArgument: uc(payload.meta?.narrativeArgument ?? payload.meta?.narrative_argument) ?? "",
    },
    principles: (payload.principles || []).map(p => ({
      ...p,
      name: uc(p.name) ?? "",
      definition: uc(p.definition) ?? "",
    })),
    entities: (payload.entities || []).map(e => ({
      ...e,
      name: uc(e.name) ?? "",
      role: uc(e.role) ?? "",
      psychology: uc(e.psychology) ?? "",
      arc: (e.arc || []).map(beat => ({
        ...beat,
        act: typeof beat.act === "number" ? beat.act : parseInt(beat.act) || 0,
        state: uc(beat.state) ?? "",
        movement: uc(beat.movement) ?? "",
      })),
    })),
    acts: (payload.acts || []).map(a => ({
      ...a,
      number: typeof a.number === "number" ? a.number : parseInt(a.number) || 0,
      title: uc(a.title) ?? "",
      question: uc(a.question) ?? "",
      tone: uc(a.tone) ?? "",
    })),
    relationships: (payload.relationships || []).map(r => ({
      ...r,
      type: uc(r.type) ?? "",
      dynamic: uc(r.dynamic) ?? "",
    })),
    expressions: (payload.expressions || []).map(x => ({
      ...x,
      content: uc(x.content) ?? "",
    })),
  };
}

/** Parse and validate JSON into ontology state. */
function parseAndValidateOntology(data, opts = {}) {
  if (!data || typeof data !== "object") {
    return { state: null, warnings: [], errors: ["Input must be a JSON object."] };
  }

  if (Array.isArray(data.principles) && Array.isArray(data.entities)) {
    const validation = runFullValidation(data);
    return {
      state: data,
      warnings: validation.warnings.map(w => `[${w.code}] ${w.field_path || w.scope}: ${w.message}`),
      errors: validation.errors.map(e => `[${e.code}] ${e.field_path || e.scope}: ${e.message}`),
    };
  }

  // Dual-track bible with ontology_payload: unwrap and use directly
  if (data.ontology_payload &&
      Array.isArray(data.ontology_payload.entities) &&
      Array.isArray(data.ontology_payload.principles)) {
    const state = unwrapOntologyPayload(data.ontology_payload);
    const validation = runFullValidation(state);
    return {
      state,
      warnings: validation.warnings.map(w => `[${w.code}] ${w.field_path || w.scope}: ${w.message}`),
      errors: validation.errors.map(e => `[${e.code}] ${e.field_path || e.scope}: ${e.message}`),
    };
  }

  const isStoryBible = [
    "meta_thesis", "metaThesis",
    "thematic_engine", "thematicEngine",
    "protagonist_architecture", "protagonistArchitecture",
    "character_definitions", "characterDefinitions",
  ].some(k => data[k] != null);

  if (!isStoryBible) {
    return {
      state: null,
      warnings: [],
      errors: ["Unsupported JSON format. Expected Story Bible or Storywright ontology."],
    };
  }

  const normalized = normalizeStoryBible(data);
  const converted = convertStoryBibleToOntology(normalized.storyBible, opts);
  const validation = converted.state ? runFullValidation(converted.state) : { warnings: [], errors: [] };
  return {
    state: converted.state,
    warnings: [
      ...normalized.warnings,
      ...converted.warnings,
      ...validation.warnings.map(w => `[${w.code}] ${w.field_path || w.scope}: ${w.message}`),
    ],
    errors: [
      ...normalized.errors,
      ...converted.errors,
      ...validation.errors.map(e => `[${e.code}] ${e.field_path || e.scope}: ${e.message}`),
    ],
  };
}

// ─── LEGACY SEED (fallback when default ontology unavailable) ─────────────────

const SEED = {
  meta: {
    title: "The Morrow Doctrine",
    subtitle: "The Self-Authored Myth-Maker and the Republic That Armed Him",
    coreStatement: "America makes exceptional individuals possible, uses them, and destroys them when they become expensive.",
    narrativeArgument: "The gap between American ideals and American practice is wide enough to be genuinely generative — and genuinely fatal.",
  },
  principles: [
    { id: "p1", name: "The Conditional License", definition: "All individual greatness operates on institutional permission. The permission is always conditional, always revocable, and always revoked when the individual's value is exceeded by their cost.", portability: "universal", redundancy: 6 },
    { id: "p2", name: "The Self-Portrait as Prison", definition: "The creator's project inevitably develops independence from its creator, because any sufficiently complex creation acquires its own logic. The creator experiences this independence as betrayal.", portability: "universal", redundancy: 4 },
    { id: "p3", name: "The Closing Frontier", definition: "Exceptional individuals require exceptional environments. When those environments close, the exceptional individual becomes an anachronism reclassified as a threat.", portability: "universal", redundancy: 3 },
    { id: "p4", name: "Mirror Blindness", definition: "The protagonist can diagnose decline and self-deception in every entity except themselves. Their clearest insight into others is powered by their blindest spot about themselves.", portability: "universal", redundancy: 5 },
    { id: "p5", name: "Complicity & Liquidation", definition: "The state uses exceptional individuals for work it cannot acknowledge. When the work becomes expensive, it sacrifices the agent rather than admit its own role.", portability: "universal", redundancy: 3 },
  ],
  entities: [
    { id: "e1", name: "Cassian Morrow", type: "character", layer: "institutional", role: "Protagonist — The Self-Authored Myth-Maker", psychology: "Experiences limits as insults. Ambition as self-expression, not collective vision. Mirror blindness prevents self-diagnosis.", servesPrinciples: ["p1","p2","p3","p4","p5"], shadow: { dependency: "p1", ordinariness: "p2", needForApproval: "p4", cruelty: "p4" }, arc: [
      { act: 1, state: "The Knight at peak", movement: "Seduction by competence" },
      { act: 2, state: "The Builder expressing", movement: "Vision crystallizes" },
      { act: 3, state: "Appetite consuming", movement: "Rationalizations elaborate" },
      { act: 4, state: "The Fracture", movement: "Self-portrait walks away" },
      { act: 5, state: "The Execution", movement: "Performance of destruction" },
    ]},
    { id: "e2", name: "Idris Caine", type: "character", layer: "institutional", role: "The Intellectual Spine", psychology: "Maintains the system because the alternative is worse. Cognitive equal, incompatible orientation.", servesPrinciples: ["p1","p5"], shadow: null, arc: [
      { act: 1, state: "Mutual assessment", movement: "Recognition" },
      { act: 3, state: "Pattern documentation", movement: "Methodical accumulation" },
      { act: 5, state: "Legal opinion delivered", movement: "Devastating, precise, right" },
    ]},
    { id: "e3", name: "Solomon Eckhart", type: "character", layer: "institutional", role: "The Road Not Taken", psychology: "Equal talent, capacity for satisfaction. Can stop. Enough.", servesPrinciples: ["p1","p3"], shadow: null, arc: [
      { act: 1, state: "Post-war grace", movement: "Celebration" },
      { act: 2, state: "Gentle warning", movement: "Concern" },
      { act: 5, state: "Trial testimony", movement: "Honest, compassionate, damning" },
    ]},
    { id: "e4", name: "Asa Lorn", type: "character", layer: "institutional", role: "The Deepest Bond", psychology: "Loyal to the person, not the project. Follows until following means becoming unrecognizable.", servesPrinciples: ["p4","p2"], shadow: null, arc: [
      { act: 1, state: "Wartime bond", movement: "Trust forged" },
      { act: 3, state: "Growing unease", movement: "Questions sharpen" },
      { act: 4, state: "Departure", movement: "The farewell — emotional climax" },
    ]},
    { id: "e5", name: "Aurelius Dane", type: "character", layer: "institutional", role: "The Unbridgeable Gap", psychology: "Loves the creation as community, not self-expression.", servesPrinciples: ["p2"], shadow: null, arc: [
      { act: 2, state: "Public intellectual", movement: "Engagement" },
      { act: 4, state: "Elected mayor", movement: "Self-portrait walks away" },
    ]},
    { id: "e6", name: "Lucan Verge", type: "character", layer: "institutional", role: "The Dark Mirror", psychology: "Comparable skill, zero self-mythology. Honest mercenary.", servesPrinciples: ["p4","p3"], shadow: null, arc: [
      { act: 1, state: "Defection", movement: "Mirror activated" },
      { act: 3, state: "Death by state", movement: "Precedent established" },
    ]},
    { id: "e7", name: "Thessaly", type: "location", layer: "institutional", role: "The Self-Portrait in Infrastructure", psychology: "Built as total self-expression; develops actual life creator cannot control.", servesPrinciples: ["p2"], arc: [
      { act: 2, state: "Vision & construction", movement: "Canvas" },
      { act: 3, state: "Community forms", movement: "Identity develops" },
      { act: 4, state: "Democratic assertion", movement: "Dane elected" },
    ]},
    { id: "e8", name: "USOC", type: "faction", layer: "institutional", role: "The Left Hand / Right Hand", psychology: "Creates authority, uses capability, builds file, destroys.", servesPrinciples: ["p1","p5"], arc: [
      { act: 1, state: "Issues LMT, covert tasking begins", movement: "License granted" },
      { act: 3, state: "Dual-tracking", movement: "File thickens" },
      { act: 5, state: "Disavowal, punitive expedition", movement: "License revoked" },
    ]},
    { id: "e9", name: "American-Meridian Co.", type: "faction", layer: "institutional", role: "Dying Institution Mirror", psychology: "Extraction machine that outlived mandate.", servesPrinciples: ["p4","p3"], arc: [
      { act: 2, state: "Service provider, studied weakness", movement: "Predator maps prey" },
      { act: 3, state: "Systematic predation", movement: "Mirror function active" },
    ]},
  ],
  relationships: [
    { id: "r1", source: "e1", target: "e2", type: "Intellectual spine", dynamic: "Cognitive equals, incompatible orientations", tension: 0.7, trajectory: "Assessment → respect → opposition → conviction" },
    { id: "r2", source: "e1", target: "e3", type: "Road not taken", dynamic: "Genuine friendship, divergent capacity for satisfaction", tension: 0.4, trajectory: "Bond → concern → grief → testimony" },
    { id: "r3", source: "e1", target: "e4", type: "Deepest bond", dynamic: "Loyalty to person not project", tension: 0.9, trajectory: "War bond → partnership → unease → departure" },
    { id: "r4", source: "e1", target: "e5", type: "Unbridgeable gap", dynamic: "Individual will vs. collective vision", tension: 0.8, trajectory: "Engagement → divergence → succession" },
    { id: "r5", source: "e1", target: "e6", type: "Dark mirror", dynamic: "Equals who cannot stand equality", tension: 0.85, trajectory: "Rivalry → pursuit → death → false conclusion" },
    { id: "r6", source: "e1", target: "e7", type: "Creator-creation", dynamic: "Self-portrait with independent will", tension: 0.95, trajectory: "Vision → construction → maturation → independence" },
    { id: "r7", source: "e1", target: "e8", type: "License holder-issuer", dynamic: "Created, used, documented, destroyed", tension: 0.75, trajectory: "Authorization → covert ops → file → revocation" },
    { id: "r8", source: "e1", target: "e9", type: "Mirror he raids", dynamic: "Diagnosis as self-description", tension: 0.6, trajectory: "Irritation → exploitation → predation" },
  ],
  acts: [
    { number: 1, title: "The Knight", episodes: "1–7", tone: "Triumphant, seductive", question: "Who is Morrow at peak, and what is the hunger he cannot name?" },
    { number: 2, title: "The Builder", episodes: "8–15", tone: "Romantic, grounding", question: "What happens when the Myth-Maker finds his canvas?" },
    { number: 3, title: "The Appetite", episodes: "16–23", tone: "Accelerating, uneasy", question: "What happens when the hunger exceeds every container?" },
    { number: 4, title: "The Fracture", episodes: "24–30", tone: "Devastating, quiet", question: "What happens when everything built develops its own will?" },
    { number: 5, title: "The Execution", episodes: "31–36", tone: "Inevitable, magnificent", question: "What does the Myth-Maker do when the myth reaches its limit?" },
  ],
  expressions: [
    { id: "x1", type: "dialogue", content: "I can't be smaller than what I've seen.", character: "e1", act: 4, servesPrinciples: ["p4","p2"], servesEntity: "e1", portability: "linguistic", redundancy: 1, note: "Ego defense against Shadow need." },
    { id: "x2", type: "dialogue", content: "The best of us, turned to purposes that were only ever his own.", character: "e3", act: 5, servesPrinciples: ["p1"], servesEntity: "e3", portability: "structural", redundancy: 1, note: "Affirms greatness, identifies redirection, names selfishness." },
    { id: "x3", type: "dialogue", content: "I know. That's why I'm leaving.", character: "e4", act: 4, servesPrinciples: ["p4"], servesEntity: "e4", portability: "linguistic", redundancy: 1, note: "Acknowledgment without accusation." },
    { id: "x4", type: "motif", content: "I Am What You Celebrate — Confirmation → Pattern → Incomprehension → Haunting Return", character: "e1", act: null, servesPrinciples: ["p1"], servesEntity: "e1", portability: "structural", redundancy: 4, note: "Morrow's central defense mechanism." },
    { id: "x5", type: "visual", content: "Mirror motif — reflective surfaces track ego coherence.", character: "e1", act: null, servesPrinciples: ["p4"], servesEntity: "e1", portability: "cultural", redundancy: 3, note: "Visual tracking of protagonist's disintegrating self-knowledge." },
    { id: "x6", type: "dialogue", content: "You call it piracy when I do it for myself. What do you call it when you do it through me?", character: "e1", act: 5, servesPrinciples: ["p5","p1"], servesEntity: "e1", portability: "structural", redundancy: 2, note: "Trial speech — implicates the audience." },
  ],
};

// ─── STORY BIBLE CONVERTER ───────────────────────────────────────────────────

function normalizeStoryBible(raw) {
  const warnings = [];
  const errors = [];
  const getKey = (obj, ...keys) => keys.reduce((v, k) => (v ?? obj?.[k]), undefined);

  const storyBible = {
    meta: raw?.meta || {},
    meta_thesis: getKey(raw, "meta_thesis", "metaThesis") || {},
    thematic_engine: getKey(raw, "thematic_engine", "thematicEngine") || {},
    protagonist_architecture: getKey(raw, "protagonist_architecture", "protagonistArchitecture") || {},
    character_definitions: getKey(raw, "character_definitions", "characterDefinitions") || {},
    faction_definitions: getKey(raw, "faction_definitions", "factionDefinitions") || {},
    narrative_structure: getKey(raw, "narrative_structure", "narrativeStructure") || {},
    world_building: getKey(raw, "world_building", "worldBuilding") || {},
    tone_and_aesthetic: getKey(raw, "tone_and_aesthetic", "toneAndAesthetic") || {},
    relationship_matrix: getKey(raw, "relationship_matrix", "relationshipMatrix") || {},
    jungian_shadow_architecture: getKey(raw, "jungian_shadow_architecture", "jungianShadowArchitecture") || {},
    protagonist_expression_guide: getKey(raw, "protagonist_expression_guide", "protagonistExpressionGuide") || {},
    set_piece_architecture: getKey(raw, "set_piece_architecture", "setPieceArchitecture") || {},
    appendices: raw?.appendices || {},
  };

  const coreRequired = [
    "meta_thesis",
    "thematic_engine",
    "protagonist_architecture",
    "character_definitions",
    "narrative_structure",
    "relationship_matrix",
  ];
  coreRequired.forEach(section => {
    if (!storyBible[section] || Object.keys(storyBible[section]).length === 0) {
      errors.push(`Missing required Story Bible section: ${section}.`);
    }
  });

  ["meta", "world_building", "tone_and_aesthetic", "appendices"].forEach(section => {
    if (!storyBible[section] || Object.keys(storyBible[section]).length === 0) {
      warnings.push(`Missing recommended section for robust import: ${section}.`);
    }
  });

  if (!storyBible.faction_definitions || Object.keys(storyBible.faction_definitions).length === 0) {
    warnings.push("Missing faction_definitions: importing without faction entities.");
  }

  const primaryThemes = getKey(storyBible.thematic_engine, "primary_themes", "primaryThemes");
  if (!Array.isArray(primaryThemes) || primaryThemes.length === 0) {
    errors.push("thematic_engine.primary_themes must be a non-empty array.");
  }

  const coreCast = getKey(storyBible.character_definitions, "core_cast", "coreCast");
  if (!Array.isArray(coreCast) || coreCast.length === 0) {
    errors.push("character_definitions.core_cast must be a non-empty array.");
  }

  const acts = getKey(storyBible.narrative_structure, "acts", "acts");
  if (!Array.isArray(acts) || acts.length === 0) {
    errors.push("narrative_structure.acts must be a non-empty array.");
  }

  const relationships = getKey(storyBible.relationship_matrix, "relationships", "relationships");
  if (!Array.isArray(relationships) || relationships.length === 0) {
    warnings.push("relationship_matrix.relationships is empty; relationship graph will be sparse.");
  }

  return { storyBible, warnings, errors };
}

function convertStoryBibleToOntology(storyBible, opts = {}) {
  const { curated = false } = opts;
  const warnings = [];
  const errors = [];
  const getKey = (obj, ...keys) => keys.reduce((v, k) => (v ?? obj?.[k]), undefined);
  const toArray = (v) => (Array.isArray(v) ? v : (v == null ? [] : [v]));
  const normalizeName = (value) => String(value || "").trim().toLowerCase();
  const actFromValue = (value) => {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  const textHead = (text) => {
    const s = String(text || "").trim();
    if (!s) return "";
    const m = s.match(/(.+?)(?:—|–|:)/);
    return (m ? m[1] : s).trim();
  };
  const splitStateMovement = (text) => {
    const s = String(text || "").trim();
    if (!s) return { state: "", movement: "" };
    const dashSplit = s.split(/\s*[—–:]\s*/);
    if (dashSplit.length >= 2) {
      return { state: dashSplit[0].trim(), movement: dashSplit.slice(1).join(" — ").trim() };
    }
    const sentenceSplit = s.match(/^([^.!?]+[.!?])\s*(.*)$/);
    if (sentenceSplit) {
      return { state: sentenceSplit[1].trim().replace(/[.!?]$/, ""), movement: sentenceSplit[2].trim() };
    }
    return { state: s, movement: "" };
  };

  const metaThesis = storyBible.meta_thesis || {};
  const thematicEngine = storyBible.thematic_engine || {};
  const protArch = storyBible.protagonist_architecture || {};
  const charDefs = storyBible.character_definitions || {};
  const factionDefs = storyBible.faction_definitions || {};
  const narrStruct = storyBible.narrative_structure || {};
  const worldBuilding = storyBible.world_building || {};

  const meta = {
    title: unwrapCanonical(storyBible.meta?.title) || "",
    subtitle: unwrapCanonical(storyBible.meta?.subtitle) || "",
    coreStatement: unwrapCanonical(getKey(metaThesis, "core_statement", "coreStatement")) || "",
    narrativeArgument: unwrapCanonical(getKey(metaThesis, "narrative_argument", "narrativeArgument")) || "",
  };

  const primaryThemes = getKey(thematicEngine, "primary_themes", "primaryThemes") || [];
  const principles = primaryThemes.map((theme, idx) => ({
    id: `p${idx + 1}`,
    name: unwrapCanonical(getKey(theme, "theme", "name")) || `Principle ${idx + 1}`,
    definition: unwrapCanonical(getKey(theme, "definition", "statement")) || "",
    portability: getKey(theme, "portability", "scope") || "universal",
    redundancy: Number(getKey(theme, "redundancy")) || 1,
  }));
  if (principles.length === 0) {
    errors.push("No principles could be extracted from thematic_engine.primary_themes.");
  }

  const principleNameToId = new Map();
  principles.forEach(p => principleNameToId.set(normalizeName(p.name), p.id));

  const resolvePrincipleIds = (rawRefs) => {
    const refs = toArray(rawRefs).map(v => String(v || "").trim()).filter(Boolean);
    return refs
      .map(ref => {
        if (principles.some(p => p.id === ref)) return ref;
        return principleNameToId.get(normalizeName(ref)) || null;
      })
      .filter(Boolean);
  };

  const actsFromStruct = Array.isArray(getKey(narrStruct, "acts", "acts")) ? getKey(narrStruct, "acts", "acts") : [];
  const acts = actsFromStruct.map((act, idx) => ({
    number: actFromValue(getKey(act, "act_number", "actNumber", "number")) ?? (idx + 1),
    title: unwrapCanonical(getKey(act, "title", "name")) || "",
    episodes: unwrapCanonical(getKey(act, "episodes", "episode_range", "episodeRange")) || "",
    tone: unwrapCanonical(getKey(act, "tone")) || "",
    question: unwrapCanonical(getKey(act, "central_question", "centralQuestion", "question")) || "",
  }));
  const orderedActNumbers = acts.map(a => a.number).sort((a, b) => a - b);
  const positionalAct = (index, total) => {
    if (orderedActNumbers.length === 0) return index + 1;
    if (orderedActNumbers.length === 1) return orderedActNumbers[0];
    const ratio = total > 1 ? (index / (total - 1)) : 0.5;
    const slot = Math.round(ratio * (orderedActNumbers.length - 1));
    return orderedActNumbers[Math.min(orderedActNumbers.length - 1, Math.max(0, slot))];
  };

  const parseArcFromItems = (items) => {
    const entries = toArray(items);
    if (entries.length === 0) return [];
    return entries.map((item, idx) => {
      const total = entries.length;
      if (item && typeof item === "object") {
        const explicitAct = actFromValue(getKey(item, "act", "act_number", "actNumber", "number"));
        const movement = unwrapCanonical(getKey(item, "movement", "title", "key_dynamic", "keyDynamic")) || "";
        const rawState = unwrapCanonical(getKey(item, "state", "scene", "description", "event", "text")) || "";
        const split = splitStateMovement(rawState);
        return {
          act: explicitAct ?? positionalAct(idx, total),
          state: split.state || textHead(rawState),
          movement: String(movement || split.movement || ""),
        };
      }
      const split = splitStateMovement(String(item || ""));
      return { act: positionalAct(idx, total), state: split.state, movement: split.movement };
    }).filter(a => a.state);
  };
  const normalizeArcForTimeline = (arcItems) => {
    const out = [];
    const byAct = new Map();
    arcItems
      .filter(a => Number.isFinite(a?.act))
      .sort((a, b) => a.act - b.act)
      .forEach(item => {
        const existing = byAct.get(item.act);
        if (!existing) {
          const clean = { act: item.act, state: String(item.state || "").trim(), movement: String(item.movement || "").trim() };
          byAct.set(item.act, clean);
          out.push(clean);
          return;
        }
        const additions = [item.state, item.movement].map(v => String(v || "").trim()).filter(Boolean);
        if (additions.length > 0) {
          existing.movement = [existing.movement, ...additions].filter(Boolean).join(" · ");
        }
      });
    return out;
  };

  const parseProtagonistArc = () => {
    const directArc = getKey(protArch, "arc", "arc_path", "arcPath");
    if (Array.isArray(directArc) && directArc.length > 0) return parseArcFromItems(directArc);

    const arcLogic = getKey(protArch, "arc_logic", "arcLogic");
    if (arcLogic && typeof arcLogic === "object") {
      const keys = [
        ["act_one", "actOne", 1],
        ["act_two", "actTwo", 2],
        ["act_three", "actThree", 3],
        ["act_four", "actFour", 4],
        ["act_five", "actFive", 5],
      ];
      const out = [];
      keys.forEach(([snake, camel, act]) => {
        const text = getKey(arcLogic, snake, camel);
        if (!text) return;
        const split = splitStateMovement(text);
        out.push({ act, state: split.state || textHead(text), movement: split.movement || "" });
      });
      if (out.length > 0) return out;
    }

    const sevenMovements = getKey(protArch, "arc_seven_movements", "arcSevenMovements", "arc_movements", "arcMovements");
    if (Array.isArray(sevenMovements) && sevenMovements.length > 0) return parseArcFromItems(sevenMovements);
    return [];
  };

  const protagonistName = unwrapCanonical(getKey(protArch, "name", "protagonist_name", "protagonistName")) || "";
  const coreCast = getKey(charDefs, "core_cast", "coreCast") || [];
  const castHasProtagonist = coreCast.some(c => normalizeName(unwrapCanonical(getKey(c, "name"))) === normalizeName(protagonistName));
  const castWithProtagonist = (!castHasProtagonist && protagonistName)
    ? [{
        name: protagonistName,
        function_in_narrative: "Protagonist",
        role: unwrapCanonical(getKey(protArch, "archetype", "title")) || "Protagonist",
        psychology: unwrapCanonical(getKey(getKey(protArch, "psychology"), "core_trait", "coreTrait")) || "",
        serves_principles: getKey(protArch, "serves_principles", "servesPrinciples", "themes", "principles") || [],
      }, ...coreCast]
    : coreCast;
  const shadowArch = storyBible.jungian_shadow_architecture || {};

  const characterEntities = castWithProtagonist.map((char, idx) => {
    const entityId = `e${idx + 1}`;
    const name = String(unwrapCanonical(getKey(char, "name")) || `Character ${idx + 1}`);
    const isProtagonist = protagonistName && normalizeName(name) === normalizeName(protagonistName);

    const rawArc = isProtagonist
      ? parseProtagonistArc()
      : (Array.isArray(char.arc) ? parseArcFromItems(char.arc) : parseArcFromItems(getKey(char, "key_scenes", "keyScenes")));
    const arc = normalizeArcForTimeline(rawArc);

    let shadow = null;
    if (isProtagonist) {
      const contents = toArray(getKey(shadowArch, "shadow_contents", "shadowContents"));
      const mapped = {};
      contents.forEach(item => {
        const quality = normalizeName(getKey(item, "disowned_quality", "disownedQuality"));
        const principleRef = getKey(item, "principle", "principle_id", "principleId", "theme", "theme_id", "themeId");
        const resolved = resolvePrincipleIds(principleRef);
        if (quality && resolved[0]) mapped[quality.replace(/\s+/g, "")] = resolved[0];
      });
      if (Object.keys(mapped).length > 0) shadow = mapped;
    }

    return {
      id: entityId,
      name,
      type: "character",
      layer: unwrapCanonical(getKey(char, "layer")) || "institutional",
      role: unwrapCanonical(getKey(char, "function_in_narrative", "functionInNarrative", "role")) || "",
      psychology: unwrapCanonical(getKey(char, "psychology", "character")) || "",
      servesPrinciples: resolvePrincipleIds(getKey(char, "serves_principles", "servesPrinciples", "themes", "principles")),
      arc,
      shadow,
    };
  });

  const allFactions = getKey(factionDefs, "factions", "items") || [];
  let factionsToConvert = allFactions;
  if (curated) {
    const marked = allFactions.filter(f =>
      getKey(f, "central", "is_central", "isCentral") === true ||
      String(getKey(f, "narrative_priority", "narrativePriority") || "").toLowerCase() === "high"
    );
    if (marked.length > 0) factionsToConvert = marked;
    else {
      factionsToConvert = allFactions.slice(0, Math.min(4, allFactions.length));
    }
  }

  const factionEntities = factionsToConvert.map((faction, idx) => ({
    id: `e${characterEntities.length + idx + 1}`,
    name: String(unwrapCanonical(getKey(faction, "name")) || `Faction ${idx + 1}`),
    type: "faction",
    layer: unwrapCanonical(getKey(faction, "layer")) || "institutional",
    role: unwrapCanonical(getKey(faction, "structural_role", "structuralRole", "archetype", "role")) || "",
    psychology: unwrapCanonical(getKey(faction, "character", "psychology")) || "",
    servesPrinciples: resolvePrincipleIds(getKey(faction, "serves_principles", "servesPrinciples", "themes", "principles")),
    arc: normalizeArcForTimeline(Array.isArray(faction.arc)
      ? parseArcFromItems(faction.arc)
      : (parseArcFromItems(getKey(faction, "key_scenes", "keyScenes")).length > 0
        ? parseArcFromItems(getKey(faction, "key_scenes", "keyScenes"))
        : parseArcFromItems(getKey(faction, "trajectory")))),
    shadow: null,
  }));

  const humanizeKey = (key) => key.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  const locationEntities = [];
  if (!curated) {
    const geography = getKey(worldBuilding, "geography") || {};
    Object.entries(geography).forEach(([key, location], idx) => {
      const loc = (location && typeof location === "object") ? location : {};
      const name = unwrapCanonical(getKey(loc, "name")) || humanizeKey(key);
      locationEntities.push({
        id: `e${characterEntities.length + factionEntities.length + idx + 1}`,
        name,
        type: "location",
        layer: unwrapCanonical(getKey(loc, "layer")) || "institutional",
        role: unwrapCanonical(getKey(loc, "narrative_function", "narrativeFunction", "role")) || (typeof location === "string" ? location : ""),
        psychology: unwrapCanonical(getKey(loc, "description")) || "",
        servesPrinciples: resolvePrincipleIds(getKey(loc, "serves_principles", "servesPrinciples", "themes", "principles")),
        arc: parseArcFromItems(getKey(loc, "arc", "key_scenes", "keyScenes")),
        shadow: null,
      });
    });
  }

  const instrumentEntities = [];
  if (!curated) {
    const keyInstruments = getKey(worldBuilding, "key_instruments", "keyInstruments") || {};
    Object.entries(keyInstruments).forEach(([key, instrument], idx) => {
      const inst = (instrument && typeof instrument === "object") ? instrument : {};
      instrumentEntities.push({
        id: `e${characterEntities.length + factionEntities.length + locationEntities.length + idx + 1}`,
        name: unwrapCanonical(getKey(inst, "name")) || key.replace(/_/g, " "),
        type: "instrument",
        layer: unwrapCanonical(getKey(inst, "layer")) || "institutional",
        role: unwrapCanonical(getKey(inst, "narrative_function", "narrativeFunction", "critical_function", "criticalFunction")) || "",
        psychology: unwrapCanonical(getKey(inst, "description")) || "",
        servesPrinciples: resolvePrincipleIds(getKey(inst, "serves_principles", "servesPrinciples", "themes", "principles")),
        arc: parseArcFromItems(getKey(inst, "arc", "key_scenes", "keyScenes")),
        shadow: null,
      });
    });
  }

  const entities = [...characterEntities, ...factionEntities, ...locationEntities, ...instrumentEntities];
  const entityIdByName = new Map();
  entities.forEach(entity => {
    entityIdByName.set(normalizeName(entity.name), entity.id);
    toArray(getKey(entity, "aliases")).forEach(alias => {
      const n = normalizeName(alias);
      if (n) entityIdByName.set(n, entity.id);
    });
  });
  // Deterministic alias mapping for relationship matrix short names:
  // map unique first/last tokens (e.g. "Caine" -> "Idris Caine").
  const tokenCandidates = new Map();
  entities.forEach(entity => {
    const parts = String(entity.name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return;
    const tokenSet = new Set();
    tokenSet.add(normalizeName(parts[0]));
    tokenSet.add(normalizeName(parts[parts.length - 1]));
    parts.forEach(part => {
      part.split("-").forEach(seg => tokenSet.add(normalizeName(seg)));
    });
    [...tokenSet].forEach(token => {
      if (!token) return;
      const list = tokenCandidates.get(token) || [];
      list.push(entity.id);
      tokenCandidates.set(token, list);
    });
  });
  tokenCandidates.forEach((ids, token) => {
    const unique = [...new Set(ids)];
    if (unique.length === 1) entityIdByName.set(token, unique[0]);
  });
  if (protagonistName) {
    const protagonistId = entities.find(e => normalizeName(e.name) === normalizeName(protagonistName))?.id;
    if (protagonistId) {
      entityIdByName.set("morrow", protagonistId);
      const lastName = String(protagonistName || "").split(/\s+/).slice(-1)[0];
      if (lastName) entityIdByName.set(normalizeName(lastName), protagonistId);
    }
  }

  const relationships = toArray(getKey(storyBible.relationship_matrix, "relationships", "edges"))
    .map((rel, idx) => {
      let sourceName = unwrapCanonical(getKey(rel, "source", "source_character", "sourceCharacter"));
      let targetName = unwrapCanonical(getKey(rel, "target", "target_character", "targetCharacter"));
      if ((!sourceName || !targetName) && rel?.pair) {
        const pairMatch = String(rel.pair).match(/(.+?)\s*[↔—-]\s*(.+)/);
        if (pairMatch) {
          sourceName = sourceName || pairMatch[1].trim();
          targetName = targetName || pairMatch[2].trim();
        }
      }
      const source = entityIdByName.get(normalizeName(sourceName));
      const target = entityIdByName.get(normalizeName(targetName));
      if (!source || !target) {
        warnings.push(`Skipped relationship with unresolved entities: ${sourceName || "?"} -> ${targetName || "?"}.`);
        return null;
      }
      const tensionRaw = getKey(rel, "tension");
      const tension = Number.isFinite(Number(tensionRaw)) ? Number(tensionRaw) : 0.5;
      return {
        id: `r${idx + 1}`,
        source,
        target,
        type: unwrapCanonical(getKey(rel, "type", "relationship_type", "relationshipType")) || "",
        dynamic: unwrapCanonical(getKey(rel, "dynamic", "description")) || "",
        tension,
        trajectory: unwrapCanonical(getKey(rel, "trajectory")) || "",
      };
    })
    .filter(Boolean);

  const expressions = [];
  const MAX_EXPRESSIONS = 120;
  const pushExpression = (raw, defaults = {}) => {
    if (expressions.length >= MAX_EXPRESSIONS) return;
    const asObj = (raw && typeof raw === "object") ? raw : {};
    const content = unwrapCanonical(getKey(asObj, "content", "line", "text", "description", "phrase")) || (typeof raw === "string" ? raw : "");
    if (!String(content || "").trim()) return;
    const act = actFromValue(getKey(asObj, "act", "act_number", "actNumber"));
    const characterRef = unwrapCanonical(getKey(asObj, "character", "speaker", "entity", "entity_name", "entityName")) || defaults.characterName || protagonistName;
    const character = entityIdByName.get(normalizeName(characterRef)) || "";
    expressions.push({
      id: `x${expressions.length + 1}`,
      type: defaults.type || getKey(asObj, "type") || "dialogue",
      content: String(content).trim(),
      character,
      act: act ?? defaults.act ?? null,
      servesPrinciples: resolvePrincipleIds(getKey(asObj, "serves_principles", "servesPrinciples", "themes", "principles", "theme")),
      servesEntity: character || "",
      portability: getKey(asObj, "portability") || defaults.portability || "linguistic",
      redundancy: Number(getKey(asObj, "redundancy")) || 1,
      note: getKey(asObj, "note", "notes") || defaults.note || "",
    });
  };

  const inferTypeFromPath = (path) => {
    const p = path.toLowerCase();
    if (p.includes("dialogue")) return "dialogue";
    if (p.includes("visual")) return "visual";
    if (p.includes("motif")) return "motif";
    if (p.includes("physical") || p.includes("bearing") || p.includes("gesture")) return "behavior";
    return "note";
  };
  const inferPortabilityFromType = (type) => {
    if (type === "dialogue") return "linguistic";
    if (type === "visual" || type === "behavior") return "cultural";
    if (type === "motif" || type === "set_piece") return "structural";
    return "linguistic";
  };
  const collectExpressionStrings = (value, path = "") => {
    if (expressions.length >= MAX_EXPRESSIONS) return;
    if (typeof value === "string") {
      const type = inferTypeFromPath(path);
      pushExpression(value, { type, portability: inferPortabilityFromType(type), note: path });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, idx) => collectExpressionStrings(item, `${path}[${idx}]`));
      return;
    }
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([k, v]) => collectExpressionStrings(v, path ? `${path}.${k}` : k));
    }
  };

  const expressionGuide = storyBible.protagonist_expression_guide || {};
  const expressionBuckets = [
    { key: "dialogue_signatures", type: "dialogue", portability: "linguistic" },
    { key: "dialogueSignatures", type: "dialogue", portability: "linguistic" },
    { key: "visual_signatures", type: "visual", portability: "cultural" },
    { key: "visualSignatures", type: "visual", portability: "cultural" },
    { key: "visual_motifs", type: "motif", portability: "cultural" },
    { key: "visualMotifs", type: "motif", portability: "cultural" },
    { key: "recurring_motifs", type: "motif", portability: "structural" },
    { key: "recurringMotifs", type: "motif", portability: "structural" },
    { key: "physical_signatures", type: "behavior", portability: "cultural" },
    { key: "physicalSignatures", type: "behavior", portability: "cultural" },
  ];
  expressionBuckets.forEach(({ key, type, portability }) => {
    toArray(expressionGuide?.[key]).forEach(item => pushExpression(item, { type, portability }));
  });
  collectExpressionStrings(expressionGuide);

  const setPieceArch = getKey(storyBible, "set_piece_architecture", "setPieceArchitecture");
  toArray(getKey(setPieceArch, "set_pieces", "setPieces")).forEach(item => {
    pushExpression(item, { type: "set_piece", portability: "structural" });
  });
  if (expressions.length === 0 && setPieceArch) {
    collectExpressionStrings(setPieceArch, "set_piece_architecture");
  }

  if (principles.length === 0 || entities.length === 0) {
    errors.push("Conversion did not produce a valid ontology (missing principles or entities).");
    return { state: null, warnings, errors };
  }

  return {
    state: {
      meta,
      principles,
      entities,
      relationships,
      acts,
      expressions,
    },
    warnings,
    errors,
  };
}

// ─── CONTEXT BUILDER ─────────────────────────────────────────────────────────

function buildContext(state) {
  if (state.principles.length === 0 && state.entities.length === 0) {
    return "The ontology is currently empty. This is a new story. Help the user develop their idea through conversation. When structural insights crystallize, propose them as ontological artifacts.";
  }
  let ctx = "";
  if (state.meta.title) ctx += `STORY: ${state.meta.title}${state.meta.subtitle ? ` — ${state.meta.subtitle}` : ""}\n`;
  if (state.meta.coreStatement) ctx += `THESIS: ${state.meta.coreStatement}\n`;
  ctx += "\nCONSTITUTIONAL PRINCIPLES:\n";
  state.principles.forEach(p => { ctx += `  [${p.id}] ${p.name}: ${p.definition} (R:${p.redundancy})\n`; });
  ctx += "\nINSTITUTIONAL ENTITIES:\n";
  state.entities.forEach(e => {
    ctx += `  [${e.id}] ${e.name} (${e.type}) — ${e.role}\n    Psychology: ${e.psychology}\n    Serves: ${e.servesPrinciples.join(", ") || "none"}\n`;
    if (e.arc.length > 0) ctx += `    Arc: ${e.arc.map(a => `Act ${a.act}: ${a.state}`).join(" → ")}\n`;
  });
  if (state.relationships.length > 0) {
    ctx += "\nRELATIONSHIPS:\n";
    state.relationships.forEach(r => {
      const s = state.entities.find(e => e.id === r.source)?.name || r.source;
      const t = state.entities.find(e => e.id === r.target)?.name || r.target;
      ctx += `  ${s} ↔ ${t}: ${r.type} (tension: ${(r.tension*100).toFixed(0)}%) — ${r.dynamic}\n`;
    });
  }
  if (state.acts.length > 0) {
    ctx += "\nACT STRUCTURE:\n";
    state.acts.forEach(a => { ctx += `  Act ${a.number}: ${a.title} — ${a.question}\n`; });
  }
  if (state.expressions.length > 0) {
    ctx += "\nEXPRESSIONS:\n";
    state.expressions.forEach(x => {
      const who = state.entities.find(e => e.id === x.character)?.name || "—";
      ctx += `  [${x.type}] "${x.content}" — ${who} (${x.portability}, R:${x.redundancy})\n`;
    });
  }
  const orphaned = state.entities.filter(e => e.servesPrinciples.length === 0);
  const uninstP = state.principles.filter(p => !state.entities.some(e => e.servesPrinciples.includes(p.id)));
  const lowR = state.expressions.filter(x => x.redundancy <= 1);
  if (orphaned.length || uninstP.length || lowR.length) {
    ctx += "\nCOHERENCE GAPS:\n";
    orphaned.forEach(e => { ctx += `  ⚠ ${e.name} serves no principle\n`; });
    uninstP.forEach(p => { ctx += `  ⚠ ${p.name} has no entity instantiation\n`; });
    lowR.forEach(x => { ctx += `  ⚠ "${x.content}" has redundancy 1 (single point of failure)\n`; });
  }

  // Semantic contract injection: include relevant contracts for active section types
  const activeSections = [];
  if (state.entities.length > 0) activeSections.push('entity');
  if (state.principles.length > 0) activeSections.push('principle');
  if (state.relationships.length > 0) activeSections.push('relationship');
  if (state.acts.length > 0) activeSections.push('act');
  if (state.entities.some(e => e.arc && e.arc.length > 0)) activeSections.push('protagonist');
  if (state.entities.some(e => e.type === 'faction')) activeSections.push('faction');
  if (activeSections.length > 0) {
    const exemplar = state.entities.length > 0 ? state.entities[0] : null;
    const primarySection = activeSections[0];
    const addendum = buildSystemPromptAddendum(primarySection, exemplar);
    if (addendum) {
      ctx += "\n\n" + addendum;
    }
  }

  return ctx;
}

const SYSTEM_PROMPT = `You are a creative collaborator in Storywright, an ontological narrative development environment. You help users develop stories through conversation. You are a creative peer — intellectually engaged, willing to push back on weak ideas, respectful of the user's creative authority.

YOUR ROLE:
- Engage in substantive creative dialogue about story structure, character psychology, thematic arguments, and narrative architecture
- Reference the current ontology naturally when relevant
- When a structural insight crystallizes — a principle, entity, relationship, expression, or arc beat becomes clear enough to name and define — propose it as an ontological artifact
- Ask questions that sharpen the user's thinking
- Challenge assumptions constructively
- Never modify the ontology without user approval via proposals

PROPOSAL FORMAT:
When proposing an ontological artifact, wrap it in XML tags. The user will see it as an interactive card they can accept, modify, or reject. Keep proposals precise.

Available proposal types:

<proposal type="principle">
{"name": "Principle Name", "definition": "Abstract, domain-independent statement."}
</proposal>

<proposal type="entity" entityType="character|faction|location">
{"name": "Entity Name", "role": "Dramatic function", "psychology": "Internal logic", "servesPrinciples": ["principle names to link"]}
</proposal>

<proposal type="relationship">
{"source": "Entity Name A", "target": "Entity Name B", "type": "Archetype label", "dynamic": "Relational dynamic", "tension": 0.7, "trajectory": "How it evolves"}
</proposal>

<proposal type="expression" exprType="dialogue|motif|visual|reference|naming">
{"content": "The expression content", "character": "Entity Name", "act": 3, "portability": "universal|structural|cultural|linguistic", "note": "Creative instruction"}
</proposal>

<proposal type="act">
{"title": "Act Title", "tone": "Emotional register", "question": "Dramatic question this act answers"}
</proposal>

<proposal type="meta">
{"title": "Story Title", "subtitle": "Subtitle", "coreStatement": "What this story argues", "narrativeArgument": "The argument in fuller form"}
</proposal>

IMPORTANT:
- Only propose when something has genuinely crystallized. Do NOT propose after every message.
- Your conversational text goes outside the proposal tags. Proposals are structured data, not prose.
- You can propose multiple artifacts in one message when a cluster of ideas comes together.
- Reference entity/principle names in proposals — the system resolves them to IDs.

CURRENT ONTOLOGY STATE:
`;

// ─── PROPOSAL PARSER ─────────────────────────────────────────────────────────

function parseProposals(text) {
  const proposalRegex = /<proposal\s+type="([^"]+)"(?:\s+entityType="([^"]+)")?(?:\s+exprType="([^"]+)")?>\s*([\s\S]*?)\s*<\/proposal>/g;
  const proposals = [];
  let cleanText = text;
  let match;
  while ((match = proposalRegex.exec(text)) !== null) {
    try {
      const data = JSON.parse(match[4]);
      proposals.push({ id: uid(), type: match[1], entityType: match[2] || "character", exprType: match[3] || "dialogue", data, status: "pending" });
      cleanText = cleanText.replace(match[0], "");
    } catch (e) { /* malformed — skip */ }
  }
  return { text: cleanText.trim(), proposals };
}

function proposalToActions(proposal, state) {
  const d = proposal.data;
  const findEntity = name => state.entities.find(e => e.name.toLowerCase() === name?.toLowerCase());
  const findPrinciple = name => state.principles.find(p => p.name.toLowerCase() === name?.toLowerCase());
  switch (proposal.type) {
    case "principle":
      return [{ type: "ADD_PRINCIPLE", name: d.name, definition: d.definition }];
    case "entity": {
      const pIds = (d.servesPrinciples || []).map(n => findPrinciple(n)?.id).filter(Boolean);
      return [{ type: "ADD_ENTITY", name: d.name, entityType: proposal.entityType, role: d.role, psychology: d.psychology, servesPrinciples: pIds, arc: d.arc || [] }];
    }
    case "relationship": {
      const src = findEntity(d.source), tgt = findEntity(d.target);
      if (!src || !tgt) return [];
      return [{ type: "ADD_RELATIONSHIP", source: src.id, target: tgt.id, relType: d.type, dynamic: d.dynamic, tension: d.tension || 0.5, trajectory: d.trajectory || "" }];
    }
    case "expression": {
      const ent = findEntity(d.character);
      const pIds = (d.servesPrinciples || []).map(n => findPrinciple(n)?.id).filter(Boolean);
      return [{ type: "ADD_EXPRESSION", exprType: proposal.exprType, content: d.content, character: ent?.id || "", act: d.act || null, servesPrinciples: pIds, portability: d.portability || "linguistic", redundancy: d.redundancy || 1, note: d.note || "" }];
    }
    case "act":
      return [{ type: "ADD_ACT", title: d.title, tone: d.tone, question: d.question }];
    case "meta":
      return [{ type: "UPDATE_META", data: d }];
    default: return [];
  }
}

// ─── UTILITY COMPONENTS (theme-aware via useT) ──────────────────────────────

function EditableText({ value: rawValue, onChange, style, multiline, placeholder, isWork, onClick }) {
  const value = (rawValue && typeof rawValue === "object" && rawValue.canonical !== undefined) ? String(rawValue.canonical) : (rawValue ?? "");
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);
  if (editing) {
    const El = multiline ? "textarea" : "input";
    return (
      <El ref={ref} value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); if (draft !== value) onChange(draft); }}
        onKeyDown={e => { if (e.key === "Enter" && !multiline) { setEditing(false); if (draft !== value) onChange(draft); } if (e.key === "Escape") { setEditing(false); setDraft(value); } }}
        onClick={onClick}
        style={{ ...style, background: t.bgInputFocus, border: `1px solid ${t.blue}`, borderRadius: "3px", outline: "none", color: t.textWork, fontFamily: isWork ? "var(--font-work)" : "inherit", fontSize: "inherit", fontWeight: "inherit", fontStyle: "inherit", padding: "2px 5px", width: "100%", resize: multiline ? "vertical" : "none", minHeight: multiline ? "60px" : "auto", boxSizing: "border-box" }}
        placeholder={placeholder} />
    );
  }
  return (
    <span onClick={(e) => { if (onClick) onClick(e); setEditing(true); }}
      style={{ ...style, cursor: "text", borderBottom: `1px dashed ${t.borderBezel}`, paddingBottom: "1px", minHeight: "1em", display: "inline-block", minWidth: "40px" }}
      title="Click to edit">
      {value || <span style={{ color: t.textUiGhost, fontStyle: "italic" }}>{placeholder || "click to edit"}</span>}
    </span>
  );
}

/**
 * InspectorModal — full canonical editor with live display preview.
 * Opens as an overlay when an inspector-mode field is clicked.
 */
function InspectorModal({ value: rawValue, fieldPath, onChange, onClose }) {
  const value = (rawValue && typeof rawValue === "object" && rawValue.canonical !== undefined) ? String(rawValue.canonical) : (rawValue ?? "");
  const t = useT();
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);
  const hint = getFieldHint(fieldPath);
  const preview = deriveDisplayText(fieldPath, draft);

  useEffect(() => { if (ref.current) ref.current.focus(); }, []);

  const handleSave = () => { if (draft !== value) onChange(draft); onClose(); };
  const handleKeyDown = (e) => { if (e.key === "Escape") onClose(); };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 999,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: t.bgPane, border: `1px solid ${t.borderBezel}`, borderRadius: "8px",
        padding: "20px", width: "min(90vw, 560px)", maxHeight: "80vh", display: "flex", flexDirection: "column",
        boxShadow: t.acrylicShadow,
      }}>
        {hint && (
          <div style={{ marginBottom: "12px", padding: "8px 10px", background: t.bgCanvas, borderRadius: "4px", border: `1px solid ${t.borderBezel}` }}>
            <div style={{ fontSize: "9px", color: t.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1px", marginBottom: "3px" }}>
              {hint.expectedForm?.replace(/_/g, " ").toUpperCase()}
            </div>
            <div style={{ fontSize: "11px", color: t.textUi, fontFamily: "var(--font-ui)", lineHeight: 1.5 }}>
              {hint.definition}
            </div>
          </div>
        )}
        <div style={{ fontSize: "9px", color: t.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1px", marginBottom: "4px" }}>CANONICAL</div>
        <textarea ref={ref} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={handleKeyDown}
          style={{
            fontSize: "13px", color: t.textWork, fontFamily: "var(--font-work)", lineHeight: 1.6,
            background: t.bgInputFocus, border: `1px solid ${t.blue}`, borderRadius: "4px",
            padding: "10px 12px", resize: "vertical", minHeight: "100px", maxHeight: "40vh",
            outline: "none", width: "100%", boxSizing: "border-box",
          }} />
        {preview && (
          <div style={{ marginTop: "12px" }}>
            <div style={{ fontSize: "9px", color: t.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1px", marginBottom: "4px" }}>
              DISPLAY PREVIEW <span style={{ fontWeight: 400, letterSpacing: 0 }}>({preview.clamp_strategy_used})</span>
            </div>
            <div style={{
              fontSize: "12px", color: t.textUi, fontFamily: "var(--font-work)", lineHeight: 1.5,
              padding: "8px 10px", background: t.bgCanvas, borderRadius: "4px", border: `1px solid ${t.borderBezel}`,
            }}>
              {preview.text || <span style={{ color: t.textUiGhost, fontStyle: "italic" }}>empty</span>}
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: "8px", marginTop: "14px", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{
            fontSize: "11px", padding: "6px 16px", borderRadius: "4px",
            border: `1px solid ${t.borderBezel}`, background: "transparent", color: t.textUi,
            cursor: "pointer", fontFamily: "var(--font-ui)",
          }}>Cancel</button>
          <button onClick={handleSave} style={{
            fontSize: "11px", padding: "6px 16px", borderRadius: "4px",
            border: `1px solid ${t.blue}`, background: t.blueTint, color: t.blue,
            cursor: "pointer", fontFamily: "var(--font-ui)", fontWeight: 600,
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}

/**
 * OntologyField — routes to the appropriate editing surface based on
 * the field's editing_mode from the constraint registry.
 *
 * - "inline":     EditableText (expand-on-focus canonical editor)
 * - "inspector":  Shows clamped display text; click opens InspectorModal
 */
function OntologyField({ fieldPath, value: rawValue, displayValue: rawDisplay, onChange, style, isWork, placeholder, multiline }) {
  const value = (rawValue && typeof rawValue === "object" && rawValue.canonical !== undefined) ? String(rawValue.canonical) : (rawValue ?? "");
  const displayValue = (rawDisplay && typeof rawDisplay === "object" && rawDisplay.canonical !== undefined) ? String(rawDisplay.canonical) : rawDisplay;
  const t = useT();
  const mode = getEditMode(fieldPath);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  if (mode === "inspector") {
    return (
      <>
        <span onClick={() => setInspectorOpen(true)}
          style={{
            ...style, cursor: "pointer", display: "inline-block", minWidth: "40px",
            borderBottom: `1px dashed ${t.borderBezel}`, paddingBottom: "1px",
          }}
          title="Click to edit in inspector">
          {displayValue || value || <span style={{ color: t.textUiGhost, fontStyle: "italic" }}>{placeholder || "click to edit"}</span>}
        </span>
        {inspectorOpen && (
          <InspectorModal value={value} fieldPath={fieldPath} onChange={onChange} onClose={() => setInspectorOpen(false)} />
        )}
      </>
    );
  }

  // Default: inline editing (same as existing EditableText)
  return (
    <EditableText value={value} onChange={onChange} style={style} multiline={multiline} placeholder={placeholder} isWork={isWork} />
  );
}

/**
 * ArcEditor — structured editor for an entity's arc array.
 * Each beat gets its own inline editing row with add/remove controls.
 */
function ArcEditor({ arc, acts, onChange, entityId, dispatch }) {
  const t = useT();

  const handleBeatChange = (beatIdx, field, value) => {
    const updated = arc.map((beat, i) => i === beatIdx ? { ...beat, [field]: value } : beat);
    onChange(updated);
  };

  const handleAddBeat = () => {
    const usedActs = new Set(arc.map(b => b.act));
    const nextAct = acts.find(a => !usedActs.has(a.number))?.number || (acts.length + 1);
    onChange([...arc, { act: nextAct, state: "", movement: "" }]);
  };

  const handleRemoveBeat = (beatIdx) => {
    onChange(arc.filter((_, i) => i !== beatIdx));
  };

  return (
    <div>
      {arc.map((beat, bi) => (
        <div key={bi} style={{
          display: "flex", gap: "6px", alignItems: "flex-start", marginBottom: "6px",
          padding: "6px 8px", background: t.bgCanvas, borderRadius: "4px", border: `1px solid ${t.borderBezel}`,
        }}>
          <select value={beat.act} onChange={e => handleBeatChange(bi, 'act', parseInt(e.target.value))}
            style={{ fontSize: "10px", fontFamily: "var(--font-ui)", background: t.bgPane, color: t.textUi, border: `1px solid ${t.borderBezel}`, borderRadius: "3px", padding: "2px 4px", width: "58px", flexShrink: 0 }}>
            {acts.map(a => <option key={a.number} value={a.number}>Act {a.number}</option>)}
          </select>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "3px" }}>
            <EditableText value={beat.state} onChange={v => handleBeatChange(bi, 'state', v)}
              style={{ fontSize: "11px", color: t.blue, fontFamily: "var(--font-ui)", fontWeight: 600 }} placeholder="State" />
            <EditableText value={beat.movement} onChange={v => handleBeatChange(bi, 'movement', v)}
              style={{ fontSize: "10px", color: t.textUi, fontFamily: "var(--font-work)" }} placeholder="Movement" isWork />
          </div>
          <span onClick={() => handleRemoveBeat(bi)}
            style={{ fontSize: "11px", color: t.textUiGhost, cursor: "pointer", padding: "2px 4px", flexShrink: 0 }}
            title="Remove beat">×</span>
        </div>
      ))}
      <div onClick={handleAddBeat}
        style={{ fontSize: "10px", color: t.textUiLight, fontFamily: "var(--font-ui)", cursor: "pointer", padding: "4px 8px", textAlign: "center", border: `1px dashed ${t.borderBezel}`, borderRadius: "4px", transition: "color 0.15s" }}
        onMouseEnter={ev => ev.currentTarget.style.color = t.blue} onMouseLeave={ev => ev.currentTarget.style.color = t.textUiLight}>
        + Add Arc Beat
      </div>
    </div>
  );
}

function TensionSlider({ value, onChange }) {
  const t = useT();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <input type="range" min="0" max="100" value={Math.round(value * 100)}
        onChange={e => onChange(parseInt(e.target.value) / 100)}
        style={{ flex: 1, accentColor: t.tension(value), height: "4px", cursor: "pointer" }} />
      <span style={{ fontSize: "10px", color: t.tension(value), fontFamily: "var(--font-ui)", fontWeight: 500, width: "32px", textAlign: "right" }}>
        {(value * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function Badge({ children, color, small }) {
  const t = useT();
  const c = color || t.textUi;
  return (
    <span style={{
      fontSize: small ? "9px" : "10px", padding: small ? "1px 5px" : "2px 7px",
      background: color ? `${c}14` : t.bgHover, color: c,
      borderRadius: "3px", border: `1px solid ${color ? `${c}30` : t.borderBezel}`,
      fontFamily: "var(--font-ui)", fontWeight: 500, letterSpacing: "0.2px", whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}


function FilesMenu({
  open,
  anchorRef,
  projects,
  statusMessage,
  warnings,
  onImport,
  onSave,
  onExportCurrent,
  onExportDualTrack,
  onLoadProject,
  onExportProject,
  onClose,
  currentProjectTitle,
}) {
  const t = useT();
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (event) => {
      const target = event.target;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains?.(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const warningItems = (warnings || []).slice(0, 3);

  return (
    <div
      ref={menuRef}
      style={{
        position: "absolute",
        top: "58px",
        right: "24px",
        width: "320px",
        padding: "16px",
        background: t.acrylic,
        border: `1px solid ${t.borderBezel}`,
        borderRadius: "8px",
        boxShadow: t.acrylicShadow,
        backdropFilter: t.acrylicBlur,
        WebkitBackdropFilter: t.acrylicBlur,
        zIndex: 250,
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      }}
    >
      <div>
        <div style={{ fontSize: "9px", color: t.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1.5px", marginBottom: "4px" }}>CURRENT PROJECT</div>
        <div style={{ fontSize: "13px", color: t.textWork, fontFamily: "var(--font-work)", fontWeight: 600 }}>{currentProjectTitle || "Untitled Project"}</div>
        <div style={{ fontSize: "10px", color: t.textUi, fontFamily: "var(--font-ui)", marginTop: "4px" }}>{statusMessage || "Ready."}</div>
        {warningItems.length > 0 && (
          <div style={{ marginTop: "6px", fontSize: "10px", color: t.yellow, fontFamily: "var(--font-ui)" }}>
            {warningItems.map((warn, idx) => (
              <div key={idx} style={{ marginBottom: "2px" }}>⚠ {warn}</div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: "9px", color: t.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1.5px", marginBottom: "6px" }}>SAVED ITERATIONS</div>
        <div style={{ maxHeight: "220px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
          {projects.length === 0 && (
            <div style={{ padding: "10px", border: `1px dashed ${t.borderBezel}`, borderRadius: "4px", fontSize: "11px", color: t.textUiLight, fontFamily: "var(--font-ui)" }}>
              No saved projects yet.
            </div>
          )}
          {projects.map(project => (
            <div key={project.id} style={{
              border: `1px solid ${t.borderBezel}`,
              borderRadius: "4px",
              padding: "8px 10px",
              background: t.bgCanvas,
              display: "flex",
              justifyContent: "space-between",
              gap: "8px",
              alignItems: "flex-start",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "12px", color: t.textWork, fontFamily: "var(--font-work)", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {project.name}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "10px", color: t.textUiLight, fontFamily: "var(--font-ui)" }}>{formatTimestampLabel(project.savedAt)}</span>
                  {project.kind && (
                    <Badge color={project.kind === "import" ? t.blue : t.textUiLight} small>
                      {project.kind}
                    </Badge>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <button onClick={() => onLoadProject(project.id)} style={{
                  fontSize: "10px",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  border: `1px solid ${t.borderBezel}`,
                  background: "transparent",
                  color: t.textUi,
                  cursor: "pointer",
                  fontFamily: "var(--font-ui)",
                }}>Load</button>
                <button onClick={() => onExportProject(project.id)} style={{
                  fontSize: "10px",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  border: `1px solid ${t.borderBezel}`,
                  background: "transparent",
                  color: t.textUiLight,
                  cursor: "pointer",
                  fontFamily: "var(--font-ui)",
                }}>Export</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={onImport} style={{
          flex: 1,
          fontSize: "11px",
          padding: "8px 0",
          borderRadius: "4px",
          border: `1px solid ${t.borderBezel}`,
          background: "transparent",
          color: t.textUi,
          cursor: "pointer",
          fontFamily: "var(--font-ui)",
        }}>Import</button>
        <button onClick={onSave} style={{
          flex: 1,
          fontSize: "11px",
          padding: "8px 0",
          borderRadius: "4px",
          border: `1px solid ${t.borderBezel}`,
          background: t.bgActive,
          color: t.textUiStrong,
          cursor: "pointer",
          fontFamily: "var(--font-ui)",
          fontWeight: 600,
        }}>Save</button>
        <button onClick={onExportCurrent} style={{
          flex: 1,
          fontSize: "11px",
          padding: "8px 0",
          borderRadius: "4px",
          border: `1px solid ${t.borderBezel}`,
          background: "transparent",
          color: t.textUi,
          cursor: "pointer",
          fontFamily: "var(--font-ui)",
        }}>Export</button>
        <button onClick={onExportDualTrack} style={{
          flex: 1,
          fontSize: "11px",
          padding: "8px 0",
          borderRadius: "4px",
          border: `1px solid ${t.borderBezel}`,
          background: "transparent",
          color: t.textUi,
          cursor: "pointer",
          fontFamily: "var(--font-ui)",
        }}>Export V2</button>
      </div>
    </div>
  );
}

// ─── PROPOSAL CARD ───────────────────────────────────────────────────────────

function ProposalCard({ proposal, onAccept, onReject }) {
  const t = useT();
  const typeColors = { principle: t.yellow, entity: t.blue, relationship: t.blue, expression: t.red, act: t.textUi, meta: t.textUiStrong };
  const color = typeColors[proposal.type] || t.textUi;
  const d = proposal.data;

  if (proposal.status === "accepted") {
    return (
      <div style={{ padding: "8px 12px", margin: "6px 0", background: t.greenTint, border: `1px solid ${t.borderBezel}`, borderRadius: "4px", borderLeft: `3px solid ${t.green}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: "var(--font-ui)" }}>
          <span style={{ fontSize: "11px", color: t.green, fontWeight: 600 }}>✓</span>
          <span style={{ fontSize: "10px", color: t.green, fontWeight: 500, letterSpacing: "0.5px" }}>Accepted</span>
          <Badge color={color} small>{proposal.type}</Badge>
          <span style={{ fontSize: "11px", color: t.textUiStrong, fontFamily: "var(--font-work)" }}>{d.name || d.title || d.content?.slice(0, 40) || "—"}</span>
        </div>
      </div>
    );
  }
  if (proposal.status === "rejected") {
    return (
      <div style={{ padding: "8px 12px", margin: "6px 0", background: t.bgCanvas, border: `1px solid ${t.borderBezel}`, borderRadius: "4px", opacity: 0.5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: "var(--font-ui)" }}>
          <span style={{ fontSize: "10px", color: t.textUiLight, fontWeight: 500, letterSpacing: "0.5px" }}>Declined</span>
          <Badge color={t.textUiLight} small>{proposal.type}</Badge>
          <span style={{ fontSize: "11px", color: t.textUiLight }}>{d.name || d.title || d.content?.slice(0, 40) || "—"}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: "14px 16px", margin: "8px 0", borderRadius: "6px", borderLeft: `3px solid ${color}`,
      background: t.acrylic, backdropFilter: t.acrylicBlur, WebkitBackdropFilter: t.acrylicBlur,
      boxShadow: t.acrylicShadow,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px", fontFamily: "var(--font-ui)" }}>
        <Badge color={color}>{proposal.type}</Badge>
        {proposal.type === "entity" && <Badge color={t.textUiLight} small>{proposal.entityType}</Badge>}
        <span style={{ fontSize: "10px", color: t.textUiLight, fontWeight: 500, letterSpacing: "0.5px" }}>Proposed</span>
      </div>
      {d.name && <div style={{ fontSize: "15px", color: t.textWork, fontFamily: "var(--font-work)", fontWeight: 600, marginBottom: "5px" }}>{d.name}</div>}
      {d.title && !d.name && <div style={{ fontSize: "15px", color: t.textWork, fontFamily: "var(--font-work)", fontWeight: 600, marginBottom: "5px" }}>{d.title}</div>}
      {d.definition && <div style={{ fontSize: "12px", color: t.textUi, fontFamily: "var(--font-work)", lineHeight: 1.55, marginBottom: "6px" }}>{deriveDisplayText('principle.definition', d.definition)?.text ?? d.definition}</div>}
      {d.role && <div style={{ fontSize: "11px", color: t.textUi, fontFamily: "var(--font-ui)" }}><span style={{ color: t.textUiLight }}>Role:</span> {deriveDisplayText('entity.role', d.role)?.text ?? d.role}</div>}
      {d.psychology && <div style={{ fontSize: "11px", color: t.textUi, fontFamily: "var(--font-ui)" }}><span style={{ color: t.textUiLight }}>Psychology:</span> {deriveDisplayText('entity.psychology', d.psychology)?.text ?? d.psychology}</div>}
      {d.dynamic && <div style={{ fontSize: "11px", color: t.textUi, fontFamily: "var(--font-ui)" }}><span style={{ color: t.textUiLight }}>Dynamic:</span> {deriveDisplayText('relationship.dynamic', d.dynamic)?.text ?? d.dynamic}</div>}
      {d.content && <div style={{ fontSize: "13px", color: t.textWork, fontFamily: "var(--font-work)", fontStyle: "italic", margin: "5px 0" }}>"{deriveDisplayText('expression.content', d.content)?.text ?? d.content}"</div>}
      {d.question && <div style={{ fontSize: "11px", color: t.textUi, fontFamily: "var(--font-ui)" }}><span style={{ color: t.textUiLight }}>Question:</span> {deriveDisplayText('act.question', d.question)?.text ?? d.question}</div>}
      {d.tone && <div style={{ fontSize: "11px", color: t.textUi, fontFamily: "var(--font-ui)" }}><span style={{ color: t.textUiLight }}>Tone:</span> {deriveDisplayText('act.tone', d.tone)?.text ?? d.tone}</div>}
      {d.coreStatement && <div style={{ fontSize: "12px", color: t.yellow, fontFamily: "var(--font-work)", margin: "4px 0" }}>{d.coreStatement}</div>}
      {d.tension != null && <div style={{ fontSize: "10px", color: t.tension(d.tension), fontFamily: "var(--font-ui)", fontWeight: 500 }}>Tension: {(d.tension * 100).toFixed(0)}%</div>}
      {d.servesPrinciples?.length > 0 && (
        <div style={{ display: "flex", gap: "4px", marginTop: "5px", flexWrap: "wrap" }}>
          {d.servesPrinciples.map((p, i) => <Badge key={i} color={t.yellow} small>{p}</Badge>)}
        </div>
      )}
      {d.note && <div style={{ fontSize: "10px", color: t.textUiLight, fontFamily: "var(--font-ui)", marginTop: "5px", fontStyle: "italic" }}>{d.note}</div>}
      <div style={{ display: "flex", gap: "8px", marginTop: "12px", fontFamily: "var(--font-ui)" }}>
        <button onClick={onAccept} style={{
          padding: "5px 16px", fontSize: "10px", fontWeight: 600, letterSpacing: "0.3px",
          background: t.green, color: "#FFFFFF", border: "none", borderRadius: "4px", cursor: "pointer",
        }}>Accept</button>
        <button onClick={onReject} style={{
          padding: "5px 16px", fontSize: "10px", fontWeight: 500, letterSpacing: "0.3px",
          background: "transparent", color: t.textUi, border: `1px solid ${t.borderBezel}`, borderRadius: "4px", cursor: "pointer",
        }}>Decline</button>
      </div>
    </div>
  );
}

// ─── CONVERSATION SURFACE ────────────────────────────────────────────────────

function ConversationPane({ state, dispatch, messages, setMessages, apiKey }) {
  const t = useT();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  const handleAcceptProposal = useCallback((msgIdx, propIdx) => {
    setMessages(prev => {
      const updated = [...prev];
      const msg = { ...updated[msgIdx], proposals: [...updated[msgIdx].proposals] };
      msg.proposals[propIdx] = { ...msg.proposals[propIdx], status: "accepted" };
      updated[msgIdx] = msg;
      return updated;
    });
    const proposal = messages[msgIdx].proposals[propIdx];
    const actions = proposalToActions(proposal, state);
    if (actions.length > 0) dispatch({ type: "BATCH_UPDATE", operations: actions });
  }, [messages, state, dispatch, setMessages]);

  const handleRejectProposal = useCallback((msgIdx, propIdx) => {
    setMessages(prev => {
      const updated = [...prev];
      const msg = { ...updated[msgIdx], proposals: [...updated[msgIdx].proposals] };
      msg.proposals[propIdx] = { ...msg.proposals[propIdx], status: "rejected" };
      updated[msgIdx] = msg;
      return updated;
    });
  }, [setMessages]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    if (!apiKey) {
      setMessages(prev => [...prev, { role: "assistant", text: "Please configure your Anthropic API key in Settings to use conversation features.", rawText: "", proposals: [] }]);
      return;
    }
    setInput("");
    const userMsg = { role: "user", text, proposals: [] };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setLoading(true);
    try {
      const apiMessages = newMessages.map(m => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.role === "user" ? m.text : (m.rawText || m.text),
      }));
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 2000, system: SYSTEM_PROMPT + buildContext(state), messages: apiMessages }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 401 || response.status === 403) {
          setMessages(prev => [...prev, { role: "assistant", text: "Invalid API key. Please check your API key in Settings.", rawText: "", proposals: [] }]);
        } else {
          setMessages(prev => [...prev, { role: "assistant", text: `API error (${response.status}): ${errorData.error?.message || "Please try again."}`, rawText: "", proposals: [] }]);
        }
        setLoading(false);
        return;
      }
      const data = await response.json();
      const rawText = data.content?.map(b => b.text || "").join("") || "I wasn't able to respond. Please try again.";
      const { text: cleanText, proposals } = parseProposals(rawText);
      setMessages(prev => [...prev, { role: "assistant", text: cleanText, rawText, proposals }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", text: "Connection error — couldn't reach the API. You can still use the Workbench to edit the ontology directly.", rawText: "", proposals: [] }]);
    }
    setLoading(false);
  }, [input, loading, messages, state, setMessages, apiKey]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: t.bgCanvas }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", paddingTop: "100px" }}>
            <div style={{ fontSize: "11px", color: t.textUiGhost, fontFamily: "var(--font-ui)", letterSpacing: "3px", textTransform: "uppercase", marginBottom: "14px" }}>Storywright</div>
            <div style={{ fontSize: "18px", color: t.textWork, fontFamily: "var(--font-work)", fontWeight: 600, marginBottom: "8px" }}>
              {state.principles.length > 0 ? state.meta.title || "Untitled" : "What story are you working on?"}
            </div>
            <div style={{ fontSize: "13px", color: t.textUi, fontFamily: "var(--font-work)", lineHeight: 1.7, maxWidth: "460px", margin: "0 auto" }}>
              {state.principles.length > 0
                ? "Continue developing the story. The ontology is loaded and I can see the full structure."
                : "Describe your idea — a premise, a character, a question, a feeling. We'll develop the structure together through conversation."}
            </div>
          </div>
        )}
        {messages.map((msg, mi) => (
          <div key={mi} style={{ marginBottom: "20px", maxWidth: "640px", marginLeft: msg.role === "user" ? "auto" : "0", marginRight: msg.role === "user" ? "0" : "auto" }}>
            <div style={{ fontSize: "10px", color: t.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 500, letterSpacing: "0.5px", marginBottom: "4px", textAlign: msg.role === "user" ? "right" : "left" }}>
              {msg.role === "user" ? "You" : "Storywright"}
            </div>
            <div style={{
              padding: "12px 16px", borderRadius: "6px", lineHeight: 1.7, fontSize: "13px",
              fontFamily: "var(--font-work)", color: t.textWork, whiteSpace: "pre-wrap",
              background: msg.role === "user" ? t.bgCanvas : t.bgPane,
              border: `1px solid ${t.borderBezel}`,
            }}>
              {msg.text}
            </div>
            {msg.proposals?.map((p, pi) => (
              <ProposalCard key={p.id} proposal={p}
                onAccept={() => handleAcceptProposal(mi, pi)}
                onReject={() => handleRejectProposal(mi, pi)} />
            ))}
          </div>
        ))}
        {loading && (
          <div style={{ marginBottom: "20px" }}>
            <div style={{ fontSize: "10px", color: t.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 500, marginBottom: "4px" }}>Storywright</div>
            <div style={{ padding: "12px 16px", borderRadius: "6px", background: t.bgPane, border: `1px solid ${t.borderBezel}` }}>
              <span style={{ color: t.textUiLight, fontSize: "13px", fontFamily: "var(--font-work)", fontStyle: "italic" }}>Thinking…</span>
            </div>
          </div>
        )}
      </div>
      <div style={{ borderTop: `1px solid ${t.borderBezel}`, padding: "14px 20px", background: t.bgPane, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
          <textarea value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Describe your idea, ask a question, challenge an assumption…"
            rows={2}
            style={{
              flex: 1, background: t.bgCanvas, border: `1px solid ${t.borderBezel}`, borderRadius: "4px",
              color: t.textWork, fontFamily: "var(--font-work)", fontSize: "13px", padding: "10px 12px",
              outline: "none", resize: "none", lineHeight: 1.5,
            }}
            onFocus={e => e.target.style.borderColor = t.blue}
            onBlur={e => e.target.style.borderColor = t.borderBezel}
          />
          <button onClick={sendMessage} disabled={loading || !input.trim()}
            style={{
              padding: "10px 20px", fontSize: "11px", fontFamily: "var(--font-ui)", fontWeight: 600,
              background: input.trim() ? t.textUiStrong : t.bgHover,
              color: input.trim() ? (t.mode === "dark" ? "#0F0F0F" : "#FFFFFF") : t.textUiGhost,
              border: "none", borderRadius: "4px", cursor: input.trim() ? "pointer" : "default",
              transition: "all 0.15s",
            }}>
            Send
          </button>
        </div>
        <div style={{ fontSize: "10px", color: t.textUiGhost, marginTop: "6px", fontFamily: "var(--font-ui)" }}>
          Enter to send · Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}

// ─── CONSTELLATION VIEW (improved node legibility) ───────────────────────────

function ConstellationView({ state, selectedEntity, onSelectEntity, selectedPrinciple, onSelectPrinciple }) {
  const t = useT();
  const containerRef = useRef(null);
  const [dims, setDims] = useState({ w: 900, h: 560 });
  const [hoveredNode, setHoveredNode] = useState(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => { for (const entry of entries) setDims({ w: entry.contentRect.width, h: entry.contentRect.height }); });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const layout = useMemo(() => {
    const cx = dims.w / 2, cy = dims.h / 2;
    const pR = Math.min(dims.w, dims.h) * 0.15, eR = Math.min(dims.w, dims.h) * 0.38;
    const principles = state.principles.map((p, i) => {
      const a = (i / state.principles.length) * Math.PI * 2 - Math.PI / 2;
      return { ...p, x: cx + Math.cos(a) * pR, y: cy + Math.sin(a) * pR };
    });
    const entities = state.entities.map((e, i) => {
      const a = (i / state.entities.length) * Math.PI * 2 - Math.PI / 2 + 0.35;
      return { ...e, x: cx + Math.cos(a) * eR, y: cy + Math.sin(a) * eR };
    });
    return { principles, entities, cx, cy };
  }, [state.principles, state.entities, dims]);

  const connections = useMemo(() => {
    const lines = [];
    if (selectedEntity) {
      const ent = state.entities.find(e => e.id === selectedEntity);
      if (ent) {
        ent.servesPrinciples.forEach(pId => {
          const pN = layout.principles.find(p => p.id === pId), eN = layout.entities.find(e => e.id === selectedEntity);
          if (pN && eN) lines.push({ x1: eN.x, y1: eN.y, x2: pN.x, y2: pN.y, kind: "serves" });
        });
        state.relationships.filter(r => r.source === selectedEntity || r.target === selectedEntity).forEach(rel => {
          const oId = rel.source === selectedEntity ? rel.target : rel.source;
          const oN = layout.entities.find(e => e.id === oId), sN = layout.entities.find(e => e.id === selectedEntity);
          if (oN && sN) lines.push({ x1: sN.x, y1: sN.y, x2: oN.x, y2: oN.y, kind: "rel", tension: rel.tension, label: rel.type });
        });
      }
    }
    if (selectedPrinciple) {
      state.entities.filter(e => e.servesPrinciples.includes(selectedPrinciple)).forEach(ent => {
        const eN = layout.entities.find(e => e.id === ent.id), pN = layout.principles.find(p => p.id === selectedPrinciple);
        if (eN && pN) lines.push({ x1: eN.x, y1: eN.y, x2: pN.x, y2: pN.y, kind: "serves" });
      });
    }
    return lines;
  }, [selectedEntity, selectedPrinciple, state, layout]);

  if (state.principles.length === 0 && state.entities.length === 0) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: t.textUiGhost, fontSize: "13px", fontFamily: "var(--font-work)", fontStyle: "italic" }}>Start a conversation to build your story's ontology</div>;
  }

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative", background: t.bgCanvas }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${dims.w} ${dims.h}`}>
        {connections.map((c, i) => (
          <g key={i}>
            <line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2}
              stroke={c.kind === "serves" ? t.yellow : t.tension(c.tension || 0.5)}
              strokeWidth={c.kind === "serves" ? 1 : 1 + (c.tension || 0.5) * 1.5}
              strokeOpacity={0.6} strokeDasharray={c.kind === "serves" ? "5,4" : "none"} style={{ transition: "all 0.3s" }} />
            {c.label && (
              <g style={{ pointerEvents: "none" }}>
                <rect x={(c.x1+c.x2)/2 - 40} y={(c.y1+c.y2)/2 - 15} width="80" height="16" rx="3" fill={t.bgCanvas} fillOpacity="0.85" />
                <text x={(c.x1+c.x2)/2} y={(c.y1+c.y2)/2 - 4} textAnchor="middle"
                  fill={t.textUi} fontSize="9" fontFamily="var(--font-ui)" fontWeight="500">{c.label}</text>
              </g>
            )}
          </g>
        ))}

        {/* PRINCIPLE NODES — constitutional core; wrapped labels within bounds */}
        {layout.principles.map(p => {
          const active = selectedPrinciple === p.id || (selectedEntity && state.entities.find(e => e.id === selectedEntity)?.servesPrinciples.includes(p.id));
          const hovered = hoveredNode === p.id;
          const r = 18 + p.redundancy * 1.5;
          const labelLines = wrapText(p.name, 16);
          const lineH = 14;
          const pillH = 16 + (labelLines.length - 1) * lineH;
          const pillTop = p.y - r - 22 - (labelLines.length - 1) * lineH;
          return (
            <g key={p.id} onClick={() => onSelectPrinciple(selectedPrinciple === p.id ? null : p.id)}
              onMouseEnter={() => setHoveredNode(p.id)} onMouseLeave={() => setHoveredNode(null)} style={{ cursor: "pointer" }}>
              <circle cx={p.x} cy={p.y} r={r}
                fill={active ? t.yellowTint : hovered ? t.bgHover : t.nodeFill}
                stroke={active ? t.yellow : t.nodeStroke} strokeWidth={active ? 2 : t.nodeStrokeW} style={{ transition: "all 0.25s" }} />
              <rect x={p.x - 52} y={pillTop} width="104" height={pillH} rx="3" fill={t.bgCanvas} fillOpacity="0.9" style={{ pointerEvents: "none" }} />
              <text x={p.x} y={pillTop + 12} textAnchor="middle" fill={active || hovered ? t.yellow : t.textUiStrong}
                fontSize="11" fontFamily="var(--font-work)" fontWeight="600" style={{ transition: "fill 0.25s", pointerEvents: "none" }}>
                {labelLines.map((line, i) => (
                  <tspan key={i} x={p.x} dy={i === 0 ? 0 : lineH}>{line}</tspan>
                ))}
              </text>
              <text x={p.x} y={p.y + 4} textAnchor="middle" fill={active ? t.yellow : t.textUi} fontSize="10" fontFamily="var(--font-ui)" fontWeight="500">R:{p.redundancy}</text>
            </g>
          );
        })}

        {/* ENTITY NODES — type-colored stroke; wrapped labels within bounds, margin from node */}
        {layout.entities.map(e => {
          const isSel = selectedEntity === e.id;
          const isConn = selectedPrinciple && e.servesPrinciples.includes(selectedPrinciple);
          const active = isSel || isConn;
          const hovered = hoveredNode === e.id;
          const col = e.type === "location" ? t.red : e.type === "faction" ? t.yellow : e.type === "instrument" ? t.green : t.blue;
          const tint = e.type === "location" ? t.redTint : e.type === "faction" ? t.yellowTint : e.type === "instrument" ? t.greenTint : t.blueTint;
          const r = isSel ? 20 : active ? 18 : 16;
          const labelLines = wrapText(e.name, 14);
          const lineH = 14;
          const pillH = 16 + (labelLines.length - 1) * lineH;
          const pillTop = e.y + r + 6;
          return (
            <g key={e.id} onClick={() => onSelectEntity(isSel ? null : e.id)}
              onMouseEnter={() => setHoveredNode(e.id)} onMouseLeave={() => setHoveredNode(null)} style={{ cursor: "pointer" }}>
              <circle cx={e.x} cy={e.y} r={r}
                fill={active ? tint : hovered ? t.bgHover : t.nodeFill}
                stroke={col}
                strokeOpacity={active ? 1 : 0.5}
                strokeWidth={active ? 2 : t.nodeStrokeW} style={{ transition: "all 0.25s" }} />
              <circle cx={e.x} cy={e.y} r={4} fill={active || hovered ? col : t.nodeStroke} style={{ transition: "fill 0.25s" }} />
              <text x={e.x} y={e.y - r - 0.5} textAnchor="middle" fill={active || hovered ? col : t.textUi} fontSize="10"
                fontFamily="var(--font-ui)" style={{ pointerEvents: "none" }}>{TYPE_ICON[e.type] || TYPE_ICON.character}</text>
              <rect x={e.x - 44} y={pillTop} width="88" height={pillH} rx="3" fill={t.bgCanvas} fillOpacity="0.9" style={{ pointerEvents: "none" }} />
              <text x={e.x} y={pillTop + 12} textAnchor="middle"
                fill={active || hovered ? t.textUiStrong : t.textUi}
                fontSize="11" fontFamily="var(--font-work)" fontWeight={active ? "600" : "500"}
                style={{ transition: "fill 0.25s", pointerEvents: "none" }}>
                {labelLines.map((line, i) => (
                  <tspan key={i} x={e.x} dy={i === 0 ? 0 : lineH}>{line}</tspan>
                ))}
              </text>
            </g>
          );
        })}
        <text x={layout.cx} y={layout.cy - 4} textAnchor="middle" fill={t.textUiGhost} fontSize="10" fontFamily="var(--font-ui)" fontWeight="500" letterSpacing="3">CONSTITUTIONAL</text>
        <text x={layout.cx} y={layout.cy + 10} textAnchor="middle" fill={t.textUiGhost} fontSize="8" fontFamily="var(--font-ui)" letterSpacing="1">CORE</text>
      </svg>
    </div>
  );
}

// ─── TENSION WEB (improved node legibility) ──────────────────────────────────

function TensionWeb({ state, selectedEntity, onSelectEntity, getDisplay }) {
  const t = useT();
  const containerRef = useRef(null);
  const [dims, setDims] = useState({ w: 900, h: 560 });
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => { for (const entry of entries) setDims({ w: entry.contentRect.width, h: entry.contentRect.height }); });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const characters = state.entities.filter(e => e.type === "character");
  const layout = useMemo(() => {
    const cx = dims.w / 2, cy = dims.h / 2, r = Math.min(dims.w, dims.h) * 0.35;
    const protag = characters.find(e => e.servesPrinciples?.length === state.principles.length) || characters[0];
    const others = characters.filter(e => e.id !== protag?.id);
    const nodes = protag ? [{ ...protag, x: cx, y: cy }] : [];
    others.forEach((c, i) => {
      const a = (i / others.length) * Math.PI * 2 - Math.PI / 2;
      nodes.push({ ...c, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    });
    return nodes;
  }, [characters, dims, state.principles.length]);

  if (characters.length === 0) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: t.textUiGhost, fontSize: "13px", fontFamily: "var(--font-work)", fontStyle: "italic" }}>No characters yet</div>;

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", background: t.bgCanvas }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${dims.w} ${dims.h}`}>
        {state.relationships.map((rel, ri) => {
          const src = layout.find(n => n.id === rel.source), tgt = layout.find(n => n.id === rel.target);
          if (!src || !tgt) return null;
          const active = selectedEntity === rel.source || selectedEntity === rel.target || hovered === rel.source || hovered === rel.target;
          return (
            <g key={rel.id}>
              <line x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                stroke={t.tension(rel.tension)} strokeWidth={active ? 2.5 : 1 + rel.tension * 2}
                strokeOpacity={active ? 0.85 : 0.15 + rel.tension * 0.35} style={{ transition: "all 0.3s" }} />
              {active && (
                <g style={{ pointerEvents: "none" }}>
                  <rect x={(src.x+tgt.x)/2 - 65} y={(src.y+tgt.y)/2 - 22} width="130" height="30" rx="4" fill={t.bgCanvas} fillOpacity="0.92" />
                  <text x={(src.x+tgt.x)/2} y={(src.y+tgt.y)/2 - 7} textAnchor="middle" fill={t.textUiStrong} fontSize="11" fontFamily="var(--font-work)" fontWeight="600">{getDisplay(`relationships[${ri}].type`, rel.type)}</text>
                  <text x={(src.x+tgt.x)/2} y={(src.y+tgt.y)/2 + 7} textAnchor="middle" fill={t.textUi} fontSize="10" fontFamily="var(--font-work)" fontStyle="italic">{getDisplay(`relationships[${ri}].dynamic`, rel.dynamic)}</text>
                </g>
              )}
            </g>
          );
        })}

        {/* CHARACTER NODES — improved: larger, stronger, labeled */}
        {layout.map((node, idx) => {
          const isSel = selectedEntity === node.id;
          const isProtag = idx === 0 && layout.length > 1;
          const isHov = hovered === node.id;
          const r = isProtag ? 26 : isSel ? 20 : 16;
          return (
            <g key={node.id} onClick={() => onSelectEntity(isSel ? null : node.id)}
              onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)} style={{ cursor: "pointer" }}>
              <circle cx={node.x} cy={node.y} r={r}
                fill={isSel ? t.blueTint : isHov ? t.bgHover : t.nodeFill}
                stroke={isProtag ? t.yellow : isSel ? t.blue : isHov ? t.textUiLight : t.nodeStroke}
                strokeWidth={isSel ? 2 : isProtag ? 2 : t.nodeStrokeW}
                style={{ transition: "all 0.25s" }} />
              {/* Inner pip */}
              <circle cx={node.x} cy={node.y} r={isProtag ? 5 : 4}
                fill={isProtag ? t.yellow : isSel ? t.blue : isHov ? t.textUi : t.nodeStroke}
                style={{ transition: "fill 0.25s" }} />
              {/* Label with background pill */}
              <rect x={node.x - 44} y={node.y + r + 5} width="88" height="18" rx="3" fill={t.bgCanvas} fillOpacity="0.92" style={{ pointerEvents: "none" }} />
              <text x={node.x} y={node.y + r + 17} textAnchor="middle"
                fill={isSel || isHov ? t.textUiStrong : t.textUi} fontSize={isProtag ? "12" : "11"}
                fontFamily="var(--font-work)" fontWeight={isProtag || isSel ? "600" : "500"} style={{ transition: "fill 0.25s", pointerEvents: "none" }}>
                {node.name.split(" ").pop()}
              </text>
              {/* Role label for protag */}
              {isProtag && <text x={node.x} y={node.y + r + 32} textAnchor="middle" fill={t.textUiLight} fontSize="9" fontFamily="var(--font-ui)" style={{ pointerEvents: "none" }}>protagonist</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── ARC TIMELINE ────────────────────────────────────────────────────────────

function ArcTimeline({ state, selectedEntity, onSelectEntity, dispatch, getDisplay }) {
  const t = useT();
  const ent = selectedEntity ? state.entities.find(e => e.id === selectedEntity) : null;
  const displayed = ent ? [ent] : state.entities.filter(e => e.arc && e.arc.length > 0);

  if (state.acts.length === 0) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: t.textUiGhost, fontSize: "13px", fontFamily: "var(--font-work)", fontStyle: "italic" }}>No acts defined yet</div>;

  return (
    <div style={{ padding: "22px 26px", overflowY: "auto", height: "100%", background: t.bgCanvas }}>
      <div style={{ display: "flex", gap: 0, marginBottom: "22px", borderBottom: `1px solid ${t.borderBezel}`, paddingBottom: "15px" }}>
        <div style={{ width: "165px", flexShrink: 0 }} />
        {state.acts.map((act, actIdx) => (
          <div key={act.number} style={{ flex: 1, padding: "7px 13px", borderLeft: `1px solid ${t.borderBezel}` }}>
            <div style={{ fontSize: "10px", color: t.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1.5px", marginBottom: "4px" }}>ACT {act.number}</div>
            <EditableText value={act.title} onChange={v => dispatch({ type: "UPDATE_ACT", number: act.number, data: { title: v } })}
              style={{ fontSize: "15px", color: t.textWork, fontFamily: "var(--font-work)", fontWeight: 600 }} isWork />
            <div style={{ fontSize: "12px", color: t.textUi, fontFamily: "var(--font-work)", lineHeight: 1.5, marginTop: "3px" }}>{getDisplay(`acts[${actIdx}].question`, act.question)}</div>
            <div style={{ fontSize: "11px", color: t.textUiLight, fontFamily: "var(--font-ui)", marginTop: "4px", fontStyle: "italic" }}>{getDisplay(`acts[${actIdx}].tone`, act.tone)}</div>
          </div>
        ))}
      </div>
      {displayed.map(entity => {
        const ei = state.entities.indexOf(entity);
        return (
        <div key={entity.id} style={{ marginBottom: "13px", cursor: "pointer" }} onClick={() => onSelectEntity(selectedEntity === entity.id ? null : entity.id)}>
          <div style={{ display: "flex", gap: 0 }}>
            <div style={{ width: "165px", flexShrink: 0, paddingRight: "13px", paddingTop: "4px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                <span style={{ color: entity.type === "location" ? t.red : t.blue, fontSize: "12px" }}>{TYPE_ICON[entity.type]}</span>
                <span style={{ fontSize: "13px", color: selectedEntity === entity.id ? t.textUiStrong : t.textUi, fontFamily: "var(--font-work)", fontWeight: 600 }}>{entity.name}</span>
              </div>
              <div style={{ fontSize: "11px", color: t.textUiLight, fontFamily: "var(--font-ui)", marginTop: "2px", marginLeft: "19px" }}>{String(getDisplay(`entities[${ei}].role`, entity.role) || "").split("—")[0].trim()}</div>
            </div>
            {state.acts.map(act => {
              const ap = entity.arc?.find(a => a.act === act.number);
              const bi = ap ? entity.arc.indexOf(ap) : -1;
              return (
                <div key={act.number} style={{
                  flex: 1, padding: "7px 11px", minHeight: "51px", borderLeft: `1px solid ${t.borderBezel}`,
                  background: ap ? (selectedEntity === entity.id ? t.blueTint : t.bgHover) : "transparent",
                  borderRadius: "3px", transition: "all 0.2s",
                }}>
                  {ap ? (
                    <>
                      <div style={{ fontSize: "12px", color: t.blue, fontFamily: "var(--font-ui)", fontWeight: 600, marginBottom: "2px" }}>{getDisplay(`entities[${ei}].arc[${bi}].state`, ap.state)}</div>
                      <div style={{ fontSize: "11px", color: t.textUi, fontFamily: "var(--font-work)", lineHeight: 1.3 }}>{getDisplay(`entities[${ei}].arc[${bi}].movement`, ap.movement)}</div>
                    </>
                  ) : (
                    <div style={{ width: "100%", height: "1px", background: t.borderBezel, marginTop: "22px", opacity: 0.5 }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        );
      })}
    </div>
  );
}

// ─── LAYER MAP ───────────────────────────────────────────────────────────────

function LayerMap({ state, onSelectEntity, onSelectPrinciple, dispatch, getDisplay }) {
  const t = useT();
  return (
    <div style={{ padding: "24px", overflowY: "auto", height: "100%", background: t.bgCanvas }}>
      {/* Constitutional */}
      <div style={{ marginBottom: "32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: t.yellow }} />
          <span style={{ fontSize: "10px", color: t.yellow, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "2px" }}>CONSTITUTIONAL</span>
          <span style={{ fontSize: "11px", color: t.textUiLight, fontFamily: "var(--font-work)", fontStyle: "italic" }}>— survives any transposition</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          {state.principles.map((p, pi) => {
            const entCount = state.entities.filter(e => e.servesPrinciples.includes(p.id)).length;
            return (
              <div key={p.id} onClick={() => onSelectPrinciple(p.id)} style={{ padding: "12px 14px", background: t.bgPane, border: `1px solid ${t.borderBezel}`, borderRadius: "4px", cursor: "pointer", transition: "all 0.15s" }}
                onMouseEnter={ev => { ev.currentTarget.style.borderColor = t.yellow; }} onMouseLeave={ev => { ev.currentTarget.style.borderColor = t.borderBezel; }}>
                <div style={{ fontSize: "13px", color: t.textWork, fontFamily: "var(--font-work)", fontWeight: 600, marginBottom: "4px" }}>{p.name}</div>
                <div style={{ fontSize: "11px", color: t.textUi, fontFamily: "var(--font-work)", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{getDisplay(`principles[${pi}].definition`, p.definition)}</div>
                <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}><Badge color={t.yellow} small>R:{p.redundancy}</Badge><Badge color={t.blue} small>{entCount} entities</Badge></div>
              </div>
            );
          })}
          <div onClick={() => dispatch({ type: "ADD_PRINCIPLE" })} style={{ padding: "12px", background: "transparent", border: `1px dashed ${t.borderBezel}`, borderRadius: "4px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: t.textUiLight, fontFamily: "var(--font-ui)", fontSize: "11px", fontWeight: 500, transition: "color 0.15s" }}
            onMouseEnter={ev => ev.currentTarget.style.color = t.yellow} onMouseLeave={ev => ev.currentTarget.style.color = t.textUiLight}>+ Add Principle</div>
        </div>
      </div>
      {/* Institutional */}
      <div style={{ marginBottom: "32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: t.blue }} />
          <span style={{ fontSize: "10px", color: t.blue, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "2px" }}>INSTITUTIONAL</span>
          <span style={{ fontSize: "11px", color: t.textUiLight, fontFamily: "var(--font-work)", fontStyle: "italic" }}>— proper nouns change, relationships persist</span>
        </div>
        {["character", "faction", "location"].map(type => {
          const items = state.entities.filter(e => e.type === type);
          if (items.length === 0 && type !== "character") return null;
          return (
            <div key={type} style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "9px", color: t.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1px", marginBottom: "6px", textTransform: "uppercase" }}>{type}s</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {items.map(e => (
                  <div key={e.id} onClick={() => onSelectEntity(e.id)} style={{ padding: "5px 10px", background: t.bgPane, border: `1px solid ${t.borderBezel}`, borderRadius: "4px", cursor: "pointer", fontSize: "11px", color: t.textUiStrong, fontFamily: "var(--font-work)", transition: "all 0.15s", display: "flex", alignItems: "center", gap: "5px" }}
                    onMouseEnter={ev => ev.currentTarget.style.borderColor = t.blue} onMouseLeave={ev => ev.currentTarget.style.borderColor = t.borderBezel}>
                    <span style={{ fontSize: "10px", color: t.blue }}>{TYPE_ICON[e.type]}</span> {e.name} <span style={{ fontSize: "9px", color: t.textUiLight, fontFamily: "var(--font-ui)" }}>({e.servesPrinciples.length}p)</span>
                  </div>
                ))}
                <div onClick={() => dispatch({ type: "ADD_ENTITY", entityType: type })} style={{ padding: "5px 10px", border: `1px dashed ${t.borderBezel}`, borderRadius: "4px", cursor: "pointer", fontSize: "11px", color: t.textUiLight, fontFamily: "var(--font-ui)", transition: "color 0.15s" }}
                  onMouseEnter={ev => ev.currentTarget.style.color = t.blue} onMouseLeave={ev => ev.currentTarget.style.color = t.textUiLight}>+</div>
              </div>
            </div>
          );
        })}
      </div>
      {/* Expressive */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: t.red }} />
          <span style={{ fontSize: "10px", color: t.red, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "2px" }}>EXPRESSIVE</span>
          <span style={{ fontSize: "11px", color: t.textUiLight, fontFamily: "var(--font-work)", fontStyle: "italic" }}>— requires reinvention under domain shift</span>
        </div>
        {state.expressions.map((x, xi) => {
          const pc = t[PORT_COLOR_K[x.portability]] || t.red;
          const dispContent = getDisplay(`expressions[${xi}].content`, x.content);
          return (
          <div key={x.id} style={{ padding: "10px 12px", marginBottom: "6px", background: t.bgPane, border: `1px solid ${t.borderBezel}`, borderLeft: `3px solid ${pc}`, borderRadius: "4px" }}>
            <div style={{ fontSize: "12px", color: t.textWork, fontFamily: "var(--font-work)", fontStyle: x.type === "dialogue" ? "italic" : "normal" }}>{x.type === "dialogue" ? `"${dispContent}"` : dispContent}</div>
            <div style={{ display: "flex", gap: "6px", marginTop: "5px", alignItems: "center" }}>
              <Badge color={pc} small>{x.portability}</Badge>
              <Badge color={x.redundancy <= 1 ? t.red : t.textUiLight} small>R:{x.redundancy}{x.redundancy <= 1 ? " ⚠" : ""}</Badge>
              <span style={{ fontSize: "10px", color: t.textUiLight, fontFamily: "var(--font-ui)" }}>{state.entities.find(e => e.id === x.character)?.name}</span>
            </div>
          </div>
          );
        })}
        <div onClick={() => dispatch({ type: "ADD_EXPRESSION" })} style={{ padding: "8px 12px", border: `1px dashed ${t.borderBezel}`, borderRadius: "4px", cursor: "pointer", fontSize: "11px", color: t.textUiLight, fontFamily: "var(--font-ui)", textAlign: "center", transition: "color 0.15s" }}
          onMouseEnter={ev => ev.currentTarget.style.color = t.red} onMouseLeave={ev => ev.currentTarget.style.color = t.textUiLight}>+ Add Expression</div>
      </div>
    </div>
  );
}

// ─── COHERENCE DASHBOARD ─────────────────────────────────────────────────────

function CoherenceView({ state }) {
  const t = useT();
  const m = useMemo(() => {
    const pCov = state.principles.map(p => ({ ...p, entCount: state.entities.filter(e => e.servesPrinciples.includes(p.id)).length, expCount: state.expressions.filter(x => x.servesPrinciples.includes(p.id)).length }));
    const orphaned = state.entities.filter(e => e.servesPrinciples.length === 0);
    const lowR = state.expressions.filter(x => x.redundancy <= 1);
    const unconnP = pCov.filter(p => p.entCount === 0);
    const totalRel = state.relationships.length;
    const avgT = state.relationships.reduce((a, r) => a + r.tension, 0) / (totalRel || 1);
    const maxArc = state.acts.length || 1;
    const protag = state.entities.find(e => e.servesPrinciples?.length === state.principles.length) || state.entities[0];
    const protagCov = protag ? (protag.arc?.length || 0) / maxArc : 0;
    let score = 100;
    score -= orphaned.length * 10; score -= unconnP.length * 15; score -= lowR.length * 4;
    if (protagCov < 1) score -= (1 - protagCov) * 20;
    return { pCov, orphaned, lowR, unconnP, totalRel, avgT, protagCov, score: Math.max(0, Math.min(100, Math.round(score))) };
  }, [state]);

  if (state.principles.length === 0) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: t.textUiGhost, fontSize: "13px", fontFamily: "var(--font-work)", fontStyle: "italic" }}>No ontology to analyze yet</div>;

  return (
    <div style={{ padding: "24px", overflowY: "auto", height: "100%", background: t.bgCanvas }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "28px" }}>
        {[
          { val: m.score, label: "COHERENCE", color: m.score > 70 ? t.green : m.score > 40 ? t.yellow : t.red },
          { val: m.totalRel, label: "RELATIONSHIPS", color: t.blue },
          { val: `${(m.avgT * 100).toFixed(0)}%`, label: "AVG TENSION", color: t.red },
          { val: `${(m.protagCov * 100).toFixed(0)}%`, label: "PROTAG ARC", color: t.yellow },
        ].map(({ val, label, color }) => (
          <div key={label} style={{ background: t.bgPane, border: `1px solid ${t.borderBezel}`, borderRadius: "4px", padding: "16px", textAlign: "center" }}>
            <div style={{ fontSize: "32px", fontFamily: "var(--font-ui)", color, fontWeight: 700 }}>{val}</div>
            <div style={{ fontSize: "9px", color: t.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "2px", marginTop: "4px" }}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{ marginBottom: "28px" }}>
        <div style={{ fontSize: "10px", color: t.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "2px", marginBottom: "12px" }}>PRINCIPLE COVERAGE</div>
        {m.pCov.map(p => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
            <div style={{ width: "150px", fontSize: "11px", color: t.textWork, fontFamily: "var(--font-work)", fontWeight: 500 }}>{p.name}</div>
            <div style={{ flex: 1, height: "4px", background: t.bgHover, borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, (p.entCount / Math.max(1, state.entities.length)) * 100)}%`, height: "100%", background: t.yellow, borderRadius: "2px", transition: "width 0.5s" }} />
            </div>
            <div style={{ fontSize: "10px", color: t.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 500, width: "70px", textAlign: "right" }}>{p.entCount}ent {p.expCount}exp</div>
          </div>
        ))}
      </div>
      {m.lowR.length > 0 && (
        <div style={{ marginBottom: "16px", padding: "14px", background: t.redTint, border: `1px solid ${t.borderBezel}`, borderRadius: "4px" }}>
          <div style={{ fontSize: "10px", color: t.red, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1px", marginBottom: "8px" }}>⚠ Single Points of Failure</div>
          {m.lowR.map(x => (
            <div key={x.id} style={{ fontSize: "12px", color: t.textWork, fontFamily: "var(--font-work)", marginBottom: "4px", paddingLeft: "10px", borderLeft: `2px solid ${t.red}30` }}>
              <span style={{ fontStyle: "italic" }}>"{x.content}"</span>
              <span style={{ color: t.textUiLight, fontSize: "10px", fontFamily: "var(--font-ui)", marginLeft: "6px" }}>— {state.entities.find(e => e.id === x.character)?.name}</span>
            </div>
          ))}
        </div>
      )}
      {m.orphaned.length > 0 && (
        <div style={{ padding: "14px", background: t.yellowTint, border: `1px solid ${t.borderBezel}`, borderRadius: "4px", marginBottom: "12px" }}>
          <div style={{ fontSize: "10px", color: t.yellow, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1px", marginBottom: "8px" }}>⚠ Orphaned — No Principle Served</div>
          {m.orphaned.map(e => (<div key={e.id} style={{ fontSize: "12px", color: t.textWork, fontFamily: "var(--font-work)", marginBottom: "3px" }}>{TYPE_ICON[e.type]} {e.name}</div>))}
        </div>
      )}
      {m.unconnP.length > 0 && (
        <div style={{ padding: "14px", background: t.yellowTint, border: `1px solid ${t.borderBezel}`, borderRadius: "4px" }}>
          <div style={{ fontSize: "10px", color: t.yellow, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1px", marginBottom: "8px" }}>⚠ Uninstantiated Principles</div>
          {m.unconnP.map(p => (<div key={p.id} style={{ fontSize: "12px", color: t.textWork, fontFamily: "var(--font-work)", marginBottom: "3px" }}>{p.name}</div>))}
        </div>
      )}
    </div>
  );
}

// ─── COMPENDIUM VIEW ─────────────────────────────────────────────────────────

function CompendiumView({ state, dispatch, onSelectEntity, getDisplay }) {
  const t = useT();
  const [expanded, setExpanded] = useState({});

  const toggleExpanded = useCallback((id) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const entityTypes = [
    { type: "character", label: "CHARACTERS", icon: "◉" },
    { type: "faction", label: "FACTIONS", icon: "⬡" },
    { type: "location", label: "LOCATIONS", icon: "◇" },
    { type: "instrument", label: "INSTRUMENTS", icon: "⬢" },
  ];

  return (
    <div style={{ padding: "24px", overflowY: "auto", height: "100%", background: t.bgCanvas }}>
      {entityTypes.map(({ type, label, icon }) => {
        const entities = state.entities.filter(e => e.type === type);
        if (entities.length === 0) return null;

        return (
          <div key={type} style={{ marginBottom: "32px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
              <span style={{ fontSize: "12px", color: t.blue }}>{icon}</span>
              <span style={{ fontSize: "10px", color: t.blue, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "2px" }}>{label}</span>
              <span style={{ fontSize: "10px", color: t.textUiLight, fontFamily: "var(--font-ui)" }}>({entities.length})</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {entities.map(entity => {
                const isExpanded = expanded[entity.id];
                const principles = state.principles.filter(p => entity.servesPrinciples.includes(p.id));
                const relationships = state.relationships.filter(r => r.source === entity.id || r.target === entity.id);
                const expressions = state.expressions.filter(x => x.character === entity.id || x.servesEntity === entity.id);
                const arcBeats = entity.arc || [];

                return (
                  <div key={entity.id} style={{ background: t.bgPane, border: `1px solid ${t.borderBezel}`, borderRadius: "4px", overflow: "hidden" }}>
                    {/* Header - Clickable */}
                    <div
                      onClick={() => toggleExpanded(entity.id)}
                      style={{
                        padding: "12px 16px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={ev => ev.currentTarget.style.background = t.bgHover}
                      onMouseLeave={ev => ev.currentTarget.style.background = t.bgPane}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: "12px", color: t.blue }}>{TYPE_ICON[entity.type]}</span>
                        <EditableText
                          value={entity.name}
                          onChange={v => {
                            dispatch({ type: "UPDATE_ENTITY", id: entity.id, data: { name: v } });
                            if (onSelectEntity) onSelectEntity(entity.id);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontSize: "14px",
                            color: t.textWork,
                            fontFamily: "var(--font-work)",
                            fontWeight: 600,
                            flex: 1,
                            minWidth: 0,
                          }}
                          isWork
                        />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <Badge color={t.blue} small>{principles.length}p</Badge>
                        <Badge color={t.red} small>{relationships.length}r</Badge>
                        <Badge color={t.red} small>{expressions.length}x</Badge>
                        <span style={{ fontSize: "12px", color: t.textUiLight, fontFamily: "var(--font-ui)", marginLeft: "4px" }}>
                          {isExpanded ? "▼" : "▶"}
                        </span>
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div style={{ padding: "16px", borderTop: `1px solid ${t.borderBezel}`, background: t.bgCanvas }}>
                        {/* Overview */}
                        <div style={{ marginBottom: "16px" }}>
                          <div style={{ fontSize: "9px", color: t.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1px", marginBottom: "6px" }}>OVERVIEW</div>
                          <div style={{ fontSize: "11px", color: t.textUi, fontFamily: "var(--font-work)", marginBottom: "4px", fontWeight: 500 }}>{getDisplay(`entities[${state.entities.indexOf(entity)}].role`, entity.role)}</div>
                          <OntologyField fieldPath="entity.psychology" value={entity.psychology}
                            displayValue={getDisplay(`entities[${state.entities.indexOf(entity)}].psychology`, entity.psychology)}
                            onChange={v => dispatch({ type: "UPDATE_ENTITY", id: entity.id, data: { psychology: v } })}
                            style={{ fontSize: "11px", color: t.textUi, fontFamily: "var(--font-work)", lineHeight: 1.5 }}
                            isWork multiline placeholder="Internal logic and motivation..." />
                        </div>

                        {/* Principles Served */}
                        {principles.length > 0 && (
                          <div style={{ marginBottom: "16px" }}>
                            <div style={{ fontSize: "9px", color: t.yellow, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1px", marginBottom: "6px" }}>PRINCIPLES</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                              {principles.map(p => (
                                <div
                                  key={p.id}
                                  onClick={() => onSelectEntity && onSelectEntity(null)}
                                  style={{
                                    padding: "4px 8px",
                                    background: t.yellowTint,
                                    border: `1px solid ${t.borderBezel}`,
                                    borderRadius: "3px",
                                    fontSize: "10px",
                                    color: t.textWork,
                                    fontFamily: "var(--font-work)",
                                    cursor: "pointer",
                                  }}
                                >
                                  {p.name}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Relationships */}
                        {relationships.length > 0 && (
                          <div style={{ marginBottom: "16px" }}>
                            <div style={{ fontSize: "9px", color: t.blue, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1px", marginBottom: "6px" }}>RELATIONSHIPS</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                              {relationships.map(rel => {
                                const other = state.entities.find(e => e.id === (rel.source === entity.id ? rel.target : rel.source));
                                if (!other) return null;
                                return (
                                  <div
                                    key={rel.id}
                                    onClick={() => onSelectEntity && onSelectEntity(other.id)}
                                    style={{
                                      padding: "8px 10px",
                                      background: t.bgPane,
                                      border: `1px solid ${t.borderBezel}`,
                                      borderRadius: "3px",
                                      cursor: "pointer",
                                      transition: "border-color 0.15s",
                                    }}
                                    onMouseEnter={ev => ev.currentTarget.style.borderColor = t.blue}
                                    onMouseLeave={ev => ev.currentTarget.style.borderColor = t.borderBezel}
                                  >
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                                      <span style={{ fontSize: "11px", color: t.textWork, fontFamily: "var(--font-work)", fontWeight: 500 }}>
                                        {rel.source === entity.id ? "→" : "←"} {other.name}
                                      </span>
                                      <Badge color={t.blue} small>{Math.round(rel.tension * 100)}%</Badge>
                                    </div>
                                    <div style={{ fontSize: "10px", color: t.textUi, fontFamily: "var(--font-work)", marginBottom: "2px" }}>{getDisplay(`relationships[${state.relationships.indexOf(rel)}].type`, rel.type)}</div>
                                    <div style={{ fontSize: "9px", color: t.textUiLight, fontFamily: "var(--font-work)", fontStyle: "italic" }}>{getDisplay(`relationships[${state.relationships.indexOf(rel)}].dynamic`, rel.dynamic)}</div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Arc Timeline */}
                        {arcBeats.length > 0 && (
                          <div style={{ marginBottom: "16px" }}>
                            <div style={{ fontSize: "9px", color: t.blue, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1px", marginBottom: "6px" }}>ARC PROGRESSION</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                              {arcBeats.map((beat, idx) => (
                                <div key={idx} style={{ padding: "6px 10px", background: t.bgPane, border: `1px solid ${t.borderBezel}`, borderRadius: "3px" }}>
                                  <div style={{ fontSize: "9px", color: t.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, marginBottom: "2px" }}>ACT {beat.act}</div>
                                  <div style={{ fontSize: "11px", color: t.textWork, fontFamily: "var(--font-work)", fontWeight: 500, marginBottom: "2px" }}>{beat.state}</div>
                                  <div style={{ fontSize: "10px", color: t.textUi, fontFamily: "var(--font-work)", fontStyle: "italic" }}>{beat.movement}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Expressions */}
                        {expressions.length > 0 && (
                          <div style={{ marginBottom: "16px" }}>
                            <div style={{ fontSize: "9px", color: t.red, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1px", marginBottom: "6px" }}>EXPRESSIONS</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                              {expressions.map(expr => (
                                <div key={expr.id} style={{ padding: "8px 10px", background: t.redTint, border: `1px solid ${t.borderBezel}`, borderRadius: "3px" }}>
                                  <div style={{ fontSize: "10px", color: t.textUiLight, fontFamily: "var(--font-ui)", marginBottom: "4px" }}>
                                    {expr.type} {expr.act && `· Act ${expr.act}`} {expr.portability && `· ${expr.portability}`}
                                  </div>
                                  <div style={{ fontSize: "11px", color: t.textWork, fontFamily: "var(--font-work)", lineHeight: 1.4, fontStyle: "italic", marginBottom: "2px" }}>
                                    "{getDisplay(`expressions[${state.expressions.indexOf(expr)}].content`, expr.content)}"
                                  </div>
                                  {expr.note && (
                                    <div style={{ fontSize: "9px", color: t.textUi, fontFamily: "var(--font-work)" }}>{expr.note}</div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Shadow Architecture */}
                        {entity.shadow && Object.keys(entity.shadow).length > 0 && (
                          <div>
                            <div style={{ fontSize: "9px", color: t.red, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1px", marginBottom: "6px" }}>SHADOW ARCHITECTURE</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              {Object.entries(entity.shadow).map(([quality, trigger]) => {
                                const triggerPrinciple = state.principles.find(p => p.id === trigger);
                                return (
                                  <div key={quality} style={{ padding: "6px 10px", background: t.redTint, border: `1px solid ${t.borderBezel}`, borderRadius: "3px" }}>
                                    <div style={{ fontSize: "10px", color: t.textWork, fontFamily: "var(--font-work)", textTransform: "capitalize" }}>
                                      {quality.replace(/([A-Z])/g, " $1").trim()}
                                    </div>
                                    {triggerPrinciple && (
                                      <div style={{ fontSize: "9px", color: t.textUiLight, fontFamily: "var(--font-work)", fontStyle: "italic", marginTop: "2px" }}>
                                        via {triggerPrinciple.name}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── INSPECTOR PANEL ─────────────────────────────────────────────────────────

function Inspector({ state, selectedEntity, selectedPrinciple, dispatch, onSelectEntity, onSelectPrinciple, getDisplay }) {
  const t = useT();
  const entity = selectedEntity ? state.entities.find(e => e.id === selectedEntity) : null;
  const principle = selectedPrinciple ? state.principles.find(p => p.id === selectedPrinciple) : null;
  const rels = selectedEntity ? state.relationships.filter(r => r.source === selectedEntity || r.target === selectedEntity) : [];
  const exprs = selectedEntity ? state.expressions.filter(x => x.character === selectedEntity || x.servesEntity === selectedEntity) : [];

  if (!entity && !principle) {
    return (
      <div style={{ padding: "24px", textAlign: "center", marginTop: "60px" }}>
        <div style={{ fontSize: "20px", color: t.textUiGhost, marginBottom: "12px" }}>◎</div>
        <div style={{ fontSize: "12px", color: t.textUiLight, fontFamily: "var(--font-work)", fontStyle: "italic", lineHeight: 1.6 }}>
          Select any element to<br />inspect and edit
        </div>
      </div>
    );
  }

  if (principle) {
    const serving = state.entities.filter(e => e.servesPrinciples.includes(principle.id));
    const servExp = state.expressions.filter(x => x.servesPrinciples.includes(principle.id));
    return (
      <div style={{ padding: "16px", overflowY: "auto", height: "100%" }}>
        <div style={{ fontSize: "9px", color: t.yellow, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "2px", marginBottom: "4px" }}>CONSTITUTIONAL PRINCIPLE</div>
        <EditableText value={principle.name} onChange={v => dispatch({ type: "UPDATE_PRINCIPLE", id: principle.id, data: { name: v } })}
          style={{ fontSize: "16px", color: t.textWork, fontFamily: "var(--font-work)", fontWeight: 600, display: "block", marginBottom: "10px" }} isWork />
        <OntologyField fieldPath="principle.definition" value={principle.definition}
          displayValue={getDisplay(`principles[${state.principles.indexOf(principle)}].definition`, principle.definition)}
          onChange={v => dispatch({ type: "UPDATE_PRINCIPLE", id: principle.id, data: { definition: v } })}
          style={{ fontSize: "12px", color: t.textUi, fontFamily: "var(--font-work)", lineHeight: "1.6", display: "block", borderLeft: `2px solid ${t.yellow}`, paddingLeft: "12px", marginBottom: "18px" }} isWork multiline />
        <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
          <div style={{ padding: "10px", background: t.bgCanvas, border: `1px solid ${t.borderBezel}`, borderRadius: "4px", flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: "18px", color: t.yellow, fontFamily: "var(--font-ui)", fontWeight: 700 }}>{principle.redundancy}</div>
            <div style={{ fontSize: "8px", color: t.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1px" }}>REDUNDANCY</div>
          </div>
          <div style={{ padding: "10px", background: t.bgCanvas, border: `1px solid ${t.borderBezel}`, borderRadius: "4px", flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: "18px", color: t.blue, fontFamily: "var(--font-ui)", fontWeight: 700 }}>{serving.length}</div>
            <div style={{ fontSize: "8px", color: t.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1px" }}>ENTITIES</div>
          </div>
        </div>
        <div style={{ fontSize: "9px", color: t.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1.5px", marginBottom: "6px" }}>INSTANTIATED BY</div>
        {serving.map(e => (
          <div key={e.id} onClick={() => { onSelectEntity(e.id); onSelectPrinciple(null); }}
            style={{ fontSize: "11px", color: t.blue, fontFamily: "var(--font-ui)", marginBottom: "5px", paddingLeft: "8px", cursor: "pointer" }}>
            {TYPE_ICON[e.type]} <span style={{ fontFamily: "var(--font-work)" }}>{e.name}</span> <span style={{ color: t.textUiLight }}>— {String(getDisplay(`entities[${state.entities.indexOf(e)}].role`, e.role) || "").split("—")[0].trim()}</span>
          </div>
        ))}
        {servExp.length > 0 && (
          <>
            <div style={{ fontSize: "9px", color: t.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1.5px", marginTop: "16px", marginBottom: "6px" }}>EXPRESSED THROUGH</div>
            {servExp.map(x => (
              <div key={x.id} style={{ fontSize: "12px", color: t.textWork, fontFamily: "var(--font-work)", marginBottom: "6px", paddingLeft: "10px", fontStyle: "italic", borderLeft: `2px solid ${t.red}30` }}>"{getDisplay(`expressions[${state.expressions.indexOf(x)}].content`, x.content)}"</div>
            ))}
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: "16px", overflowY: "auto", height: "100%" }}>
      <div style={{ fontSize: "9px", color: t.blue, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "2px", marginBottom: "4px" }}>{entity.type.toUpperCase()} — INSTITUTIONAL</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
        <EditableText value={entity.name} onChange={v => dispatch({ type: "UPDATE_ENTITY", id: entity.id, data: { name: v } })}
          style={{ fontSize: "16px", color: t.textWork, fontFamily: "var(--font-work)", fontWeight: 600 }} isWork />
        <EditableText value={entity.role} onChange={v => dispatch({ type: "UPDATE_ENTITY", id: entity.id, data: { role: v } })}
          style={{ fontSize: "11px", color: t.textUi, fontFamily: "var(--font-work)", fontStyle: "italic" }} isWork />
      </div>
      <div style={{ fontSize: "9px", color: t.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1.5px", marginBottom: "4px" }}>PSYCHOLOGY</div>
      <OntologyField fieldPath="entity.psychology" value={entity.psychology}
        displayValue={getDisplay(`entities[${state.entities.indexOf(entity)}].psychology`, entity.psychology)}
        onChange={v => dispatch({ type: "UPDATE_ENTITY", id: entity.id, data: { psychology: v } })}
        style={{ fontSize: "12px", color: t.textWork, fontFamily: "var(--font-work)", lineHeight: "1.6", display: "block", padding: "10px 12px", background: t.bgCanvas, border: `1px solid ${t.borderBezel}`, borderRadius: "4px", marginBottom: "18px" }} isWork multiline />
      <div style={{ fontSize: "9px", color: t.yellow, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1.5px", marginBottom: "6px" }}>SERVES PRINCIPLES</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "18px" }}>
        {state.principles.map(p => {
          const linked = entity.servesPrinciples.includes(p.id);
          return (
            <span key={p.id} onClick={() => dispatch({ type: "TOGGLE_PRINCIPLE_LINK", entityId: entity.id, principleId: p.id })}
              style={{ fontSize: "10px", padding: "3px 8px", borderRadius: "3px", cursor: "pointer", transition: "all 0.15s", fontFamily: "var(--font-ui)", fontWeight: 500,
                background: linked ? t.yellowTint : "transparent", color: linked ? t.yellow : t.textUiLight,
                border: `1px solid ${linked ? t.yellow : t.borderBezel}` }}>{p.name}</span>
          );
        })}
      </div>
      {rels.length > 0 && (
        <>
          <div style={{ fontSize: "9px", color: t.blue, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1.5px", marginBottom: "6px" }}>RELATIONSHIPS</div>
          {rels.map(rel => {
            const otherId = rel.source === entity.id ? rel.target : rel.source;
            const other = state.entities.find(e => e.id === otherId);
            return (
              <div key={rel.id} style={{ marginBottom: "10px", padding: "10px 12px", background: t.bgCanvas, borderRadius: "4px", border: `1px solid ${t.borderBezel}`, borderLeft: `3px solid ${t.tension(rel.tension)}` }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
                  <span onClick={() => onSelectEntity(otherId)} style={{ fontSize: "12px", color: t.textWork, fontFamily: "var(--font-work)", cursor: "pointer", fontWeight: 500 }}>↔ {other?.name}</span>
                  <EditableText value={rel.type} onChange={v => dispatch({ type: "UPDATE_RELATIONSHIP", id: rel.id, data: { type: v } })}
                    style={{ fontSize: "11px", color: t.blue, fontFamily: "var(--font-ui)" }} placeholder="relationship type" />
                </div>
                <OntologyField fieldPath="relationship.dynamic" value={rel.dynamic}
                  displayValue={getDisplay(`relationships[${state.relationships.indexOf(rel)}].dynamic`, rel.dynamic)}
                  onChange={v => dispatch({ type: "UPDATE_RELATIONSHIP", id: rel.id, data: { dynamic: v } })}
                  style={{ fontSize: "11px", color: t.textUi, fontFamily: "var(--font-work)", display: "block", marginTop: "2px" }} isWork placeholder="dynamic" />
                <div style={{ marginTop: "6px" }}><TensionSlider value={rel.tension} onChange={v => dispatch({ type: "UPDATE_RELATIONSHIP", id: rel.id, data: { tension: v } })} /></div>
                <EditableText value={rel.trajectory} onChange={v => dispatch({ type: "UPDATE_RELATIONSHIP", id: rel.id, data: { trajectory: v } })}
                  style={{ fontSize: "10px", color: t.textUiLight, fontFamily: "var(--font-ui)", display: "block", marginTop: "4px" }} placeholder="trajectory" />
              </div>
            );
          })}
        </>
      )}
      {exprs.length > 0 && (
        <>
          <div style={{ fontSize: "9px", color: t.red, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1.5px", marginTop: "16px", marginBottom: "6px" }}>EXPRESSIVE LAYER</div>
          {exprs.map(x => {
            const pc = t[PORT_COLOR_K[x.portability]] || t.red;
            return (
            <div key={x.id} style={{ marginBottom: "8px", padding: "10px 12px", background: t.bgCanvas, borderRadius: "4px", border: `1px solid ${t.borderBezel}`, borderLeft: `3px solid ${pc}` }}>
              <OntologyField fieldPath="expression.content" value={x.content}
                displayValue={getDisplay(`expressions[${state.expressions.indexOf(x)}].content`, x.content)}
                onChange={v => dispatch({ type: "UPDATE_EXPRESSION", id: x.id, data: { content: v } })}
                style={{ fontSize: "12px", color: t.textWork, fontFamily: "var(--font-work)", fontStyle: x.type === "dialogue" ? "italic" : "normal", display: "block", marginBottom: "4px" }} isWork />
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <Badge color={pc} small>{x.portability}</Badge>
                <Badge color={x.redundancy <= 1 ? t.red : t.textUiLight} small>R:{x.redundancy}{x.redundancy <= 1 ? " ⚠" : ""}</Badge>
              </div>
              {x.note && <EditableText value={x.note} multiline onChange={v => dispatch({ type: "UPDATE_EXPRESSION", id: x.id, data: { note: v } })}
                style={{ fontSize: "10px", color: t.textUiLight, fontFamily: "var(--font-ui)", lineHeight: "1.4", display: "block", marginTop: "6px" }} />}
            </div>
            );
          })}
        </>
      )}
      {entity.shadow && (
        <>
          <div style={{ fontSize: "9px", color: t.red, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1.5px", marginTop: "16px", marginBottom: "6px" }}>SHADOW ARCHITECTURE</div>
          {Object.entries(entity.shadow).map(([quality, trigger]) => {
            const tP = state.principles.find(p => p.id === trigger);
            return (
              <div key={quality} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "5px", padding: "6px 10px", background: t.redTint, border: `1px solid ${t.borderBezel}`, borderRadius: "4px" }}>
                <span style={{ fontSize: "11px", color: t.red, fontFamily: "var(--font-ui)", fontWeight: 500, textTransform: "capitalize" }}>{quality.replace(/([A-Z])/g, " $1").trim()}</span>
                {tP && <span style={{ fontSize: "10px", color: t.textUiLight, fontFamily: "var(--font-ui)" }}>via {tP.name}</span>}
              </div>
            );
          })}
        </>
      )}
      <div onClick={() => dispatch({ type: "ADD_EXPRESSION", character: entity.id })}
        style={{ marginTop: "18px", padding: "7px", border: `1px dashed ${t.borderBezel}`, borderRadius: "4px", cursor: "pointer", fontSize: "10px", color: t.textUiLight, fontFamily: "var(--font-ui)", textAlign: "center", transition: "color 0.15s" }}
        onMouseEnter={ev => ev.currentTarget.style.color = t.red} onMouseLeave={ev => ev.currentTarget.style.color = t.textUiLight}>+ Add Expression</div>
    </div>
  );
}

// ─── API KEY MODAL ────────────────────────────────────────────────────────────

function ApiKeyModal({ onSave, onCancel, initialKey = "" }) {
  const t = useT();
  const [key, setKey] = useState(initialKey);
  const [error, setError] = useState("");

  const handleSave = () => {
    const trimmed = key.trim();
    if (!trimmed) {
      setError("Please enter an API key");
      return;
    }
    if (!trimmed.startsWith("sk-ant-")) {
      setError("Anthropic API keys start with 'sk-ant-'");
      return;
    }
    onSave(trimmed);
  };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0, 0, 0, 0.5)", display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000,
    }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        background: t.acrylic, backdropFilter: t.acrylicBlur, WebkitBackdropFilter: t.acrylicBlur,
        boxShadow: t.acrylicShadow, borderRadius: "8px", padding: "24px", maxWidth: "480px", width: "90%",
        border: `1px solid ${t.borderBezel}`,
      }}>
        <div style={{ fontSize: "14px", fontWeight: 600, color: t.textUiStrong, fontFamily: "var(--font-ui)", marginBottom: "8px" }}>
          Anthropic API Key Required
        </div>
        <div style={{ fontSize: "12px", color: t.textUi, fontFamily: "var(--font-ui)", lineHeight: 1.6, marginBottom: "16px" }}>
          Storywright needs your Anthropic API key to enable conversation features. Your key is stored locally in your browser and never sent to any server except Anthropic's API.
        </div>
        <div style={{ marginBottom: "12px" }}>
          <input
            type="password"
            value={key}
            onChange={e => { setKey(e.target.value); setError(""); }}
            onKeyDown={e => { if (e.key === "Enter") handleSave(); }}
            placeholder="sk-ant-..."
            autoFocus
            style={{
              width: "100%", padding: "10px 12px", fontSize: "13px", fontFamily: "var(--font-ui)",
              background: t.bgCanvas, border: `1px solid ${error ? t.red : t.borderBezel}`, borderRadius: "4px",
              color: t.textWork, outline: "none",
            }}
          />
          {error && (
            <div style={{ fontSize: "11px", color: t.red, fontFamily: "var(--font-ui)", marginTop: "6px" }}>
              {error}
            </div>
          )}
        </div>
        <div style={{ fontSize: "11px", color: t.textUiLight, fontFamily: "var(--font-ui)", marginBottom: "16px" }}>
          Get your API key at <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" style={{ color: t.blue, textDecoration: "none" }}>console.anthropic.com</a>
        </div>
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{
            padding: "8px 16px", fontSize: "11px", fontFamily: "var(--font-ui)", fontWeight: 500,
            background: "transparent", color: t.textUi, border: `1px solid ${t.borderBezel}`, borderRadius: "4px",
            cursor: "pointer",
          }}>
            Cancel
          </button>
          <button onClick={handleSave} style={{
            padding: "8px 16px", fontSize: "11px", fontFamily: "var(--font-ui)", fontWeight: 600,
            background: t.textUiStrong, color: t.mode === "dark" ? "#0F0F0F" : "#FFFFFF", border: "none", borderRadius: "4px",
            cursor: "pointer",
          }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── THEME TOGGLE ────────────────────────────────────────────────────────────

function ThemeToggle({ isDark, onToggle }) {
  const t = useT();
  return (
    <button onClick={onToggle} title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        width: "32px", height: "18px", borderRadius: "9px", border: `1px solid ${t.borderBezel}`,
        background: isDark ? t.bgActive : t.bgCanvas, cursor: "pointer", position: "relative",
        padding: 0, transition: "all 0.2s", flexShrink: 0,
      }}>
      <div style={{
        width: "12px", height: "12px", borderRadius: "6px",
        background: isDark ? t.textUiStrong : t.textUiLight,
        position: "absolute", top: "2px", left: isDark ? "16px" : "2px",
        transition: "all 0.2s",
      }} />
    </button>
  );
}

// ─── MAIN APPLICATION ────────────────────────────────────────────────────────

const VIEWS = [
  { id: "constellation", label: "Constellation", icon: "◎" },
  { id: "tension", label: "Tension Web", icon: "⬡" },
  { id: "arc", label: "Arc Timeline", icon: "▸" },
  { id: "layers", label: "Layer Map", icon: "≡" },
  { id: "coherence", label: "Coherence", icon: "◈" },
  { id: "compendium", label: "Compendium", icon: "📖" },
];

export default function Storywright() {
  const [undoState, dispatch] = useReducer(undoReducer, { past: [], present: EMPTY, future: [] });
  const state = undoState.present;
  const displayMap = useMemo(() => deriveAllDisplayFields(state), [state]);
  const getDisplay = useCallback((key, fallback) => displayMap.get(key)?.text ?? fallback ?? "", [displayMap]);
  const [ontologyLoading, setOntologyLoading] = useState(true);
  const [surface, setSurface] = useState("conversation");
  const [view, setView] = useState("constellation");
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [selectedPrinciple, setSelectedPrinciple] = useState(null);
  const [showMeta, setShowMeta] = useState(false);
  const [messages, setMessages] = useState([]);
  const [isDark, setIsDark] = useState(true);
  const [apiKey, setApiKey] = useState(() => {
    try {
      return localStorage.getItem("STORYWRIGHT_API_KEY") || "";
    } catch {
      return "";
    }
  });
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const filesButtonRef = useRef(null);
  const [filesMenuOpen, setFilesMenuOpen] = useState(false);
  const [filesStatus, setFilesStatus] = useState("Ready.");
  const [filesWarnings, setFilesWarnings] = useState([]);
  const [currentSourceName, setCurrentSourceName] = useState("Default Ontology");
  const { projects, saveProject } = useStoredProjects();

  const theme = isDark ? DARK : LIGHT;
  const currentProjectTitle = state.meta.title?.trim() || "Untitled Project";

  useEffect(() => {
    if (!apiKey && messages.length === 0 && surface === "conversation") {
      setShowApiKeyModal(true);
    }
  }, [apiKey, messages.length, surface]);

  useEffect(() => {
    let cancelled = false;
    fetch(DEFAULT_ONTOLOGY_PATH)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error("Not found"))))
      .then(data => {
        if (cancelled) return;
        const parsed = parseAndValidateOntology(data);
        if (parsed.state) {
          dispatch({ type: "LOAD_STATE", state: parsed.state });
          setFilesStatus("Loaded default ontology");
          setFilesWarnings(parsed.warnings || []);
          setCurrentSourceName("Default Ontology");
        }
      })
      .catch(() => {
        if (!cancelled) {
          dispatch({ type: "LOAD_STATE", state: SEED });
          setFilesStatus("Loaded seed ontology");
          setFilesWarnings([]);
          setCurrentSourceName("Seed Ontology");
        }
      })
      .finally(() => {
        if (!cancelled) setOntologyLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const handleSaveApiKey = useCallback((key) => {
    try {
      localStorage.setItem("STORYWRIGHT_API_KEY", key);
      setApiKey(key);
      setShowApiKeyModal(false);
    } catch (err) {
      console.error("Failed to save API key:", err);
    }
  }, []);

  const handleClearApiKey = useCallback(() => {
    try {
      localStorage.removeItem("STORYWRIGHT_API_KEY");
      setApiKey("");
      setShowApiKeyModal(true);
    } catch (err) {
      console.error("Failed to clear API key:", err);
    }
  }, []);

  const handleSelectEntity = useCallback(id => { setSelectedEntity(id); setSelectedPrinciple(null); }, []);
  const handleSelectPrinciple = useCallback(id => { setSelectedPrinciple(id); setSelectedEntity(null); }, []);

  useEffect(() => {
    const handler = e => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); dispatch({ type: "UNDO" }); }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) { e.preventDefault(); dispatch({ type: "REDO" }); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const exportOntology = useCallback((payload, filenameHint = "storywright") => {
    const snapshot = cloneState(payload);
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${filenameHint || "storywright"}.json`; a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleExport = useCallback(() => {
    const filename = state.meta.title?.trim() || “storywright”;
    exportOntology(state, filename);
    setFilesStatus(`Exported “${filename}”`);
    setFilesWarnings([]);
  }, [state, exportOntology]);

  const handleExportDualTrack = useCallback(() => {
    const filename = state.meta.title?.trim() || “storywright”;
    const dualTrack = exportWithDualTrack(state);
    exportOntology(dualTrack, `${filename}-v2`);
    setFilesStatus(`Exported dual-track “${filename}-v2”`);
    setFilesWarnings([]);
  }, [state, exportOntology]);

  const handleSaveProjectSnapshot = useCallback(() => {
    const snapshot = cloneState(state);
    const label = deriveProjectName(state.meta.title);
    const record = saveProject({ name: label, state: snapshot, sourceName: currentSourceName, kind: "save" });
    setFilesStatus(`Saved “${record.name}”`);
    setFilesWarnings([]);
    setFilesMenuOpen(false);
  }, [state, saveProject, currentSourceName]);

  const handleLoadProject = useCallback((projectId) => {
    const entry = projects.find(p => p.id === projectId);
    if (!entry) return;
    const snapshot = cloneState(entry.state);
    dispatch({ type: "LOAD_STATE", state: snapshot });
    setMessages([]);
    setSelectedEntity(null);
    setSelectedPrinciple(null);
    setFilesStatus(`Loaded “${entry.name}”`);
    setFilesWarnings([]);
    setCurrentSourceName(entry.sourceName || entry.name);
    setFilesMenuOpen(false);
  }, [projects, dispatch]);

  const handleExportProject = useCallback((projectId) => {
    const entry = projects.find(p => p.id === projectId);
    if (!entry) return;
    exportOntology(entry.state, entry.name);
    setFilesStatus(`Exported “${entry.name}”`);
    setFilesWarnings([]);
  }, [projects, exportOntology]);

  const handleImport = useCallback(() => {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".json";
    input.onchange = e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const data = JSON.parse(ev.target.result);
          const parsed = parseAndValidateOntology(data);
          if (parsed.state) {
            const snapshot = cloneState(parsed.state);
            dispatch({ type: "LOAD_STATE", state: snapshot });
            setMessages([]);
            setSelectedEntity(null);
            setSelectedPrinciple(null);
            if (parsed.warnings.length > 0) {
              console.warn("Import warnings:", parsed.warnings);
            }
            if (parsed.errors.length > 0) {
              alert(`Import completed with validation issues:\n- ${parsed.errors.join("\n- ")}`);
            }
            const fileLabel = file.name || "Imported file";
            const inferredName = parsed.state?.meta?.title?.trim() || fileLabel.replace(/\.json$/i, "") || deriveProjectName();
            saveProject({ name: inferredName, state: snapshot, sourceName: fileLabel, kind: "import" });
            setFilesStatus(`Imported “${fileLabel}”`);
            setFilesWarnings(parsed.warnings || []);
            setCurrentSourceName(fileLabel);
            setFilesMenuOpen(false);
          } else {
            const details = parsed.errors.length > 0 ? `\n\n${parsed.errors.join("\n")}` : "";
            alert("Invalid file format. Please import a Story Bible JSON or Storywright ontology JSON." + details);
            setFilesStatus("Import failed");
            setFilesWarnings(parsed.errors || []);
          }
        } catch (err) {
          alert("Error parsing JSON file: " + err.message);
          setFilesStatus("Import failed");
          setFilesWarnings([]);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [dispatch, saveProject]);

  const handleNew = useCallback(() => {
    dispatch({ type: "LOAD_STATE", state: EMPTY });
    setMessages([]);
    setSurface("conversation");
    setSelectedEntity(null);
    setSelectedPrinciple(null);
    setFilesStatus("Started new project");
    setFilesWarnings([]);
    setCurrentSourceName("New Project");
  }, []);

  const layerActivity = useMemo(() => {
    if (surface === "conversation") return [0.3, 0.3, 0.3];
    const map = { constellation: [1, 0.5, 0.15], tension: [0.15, 1, 0.2], arc: [0.15, 1, 0.2], layers: [0.7, 0.7, 0.7], coherence: [0.6, 0.4, 0.4] };
    return map[view] || [0.3, 0.3, 0.3];
  }, [view, surface]);

  const btnStyle = (active) => ({
    padding: "4px 12px", fontSize: "11px", fontFamily: "var(--font-ui)", fontWeight: active ? 600 : 400,
    borderRadius: "4px", border: "none", cursor: "pointer", transition: "all 0.1s",
    background: active ? theme.bgActive : "transparent", color: active ? theme.textUiStrong : theme.textUi,
  });

  return (
    <ThemeCtx.Provider value={theme}>
      <div style={{
        "--font-ui": "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        "--font-work": "'Charter', 'Georgia', serif",
        width: "100%", height: "100vh", display: "flex", flexDirection: "column",
        background: theme.bgCanvas, color: theme.textUiStrong, fontFamily: "var(--font-ui)", overflow: "hidden",
        transition: "background 0.3s, color 0.3s",
        minWidth: "1200px",
        margin: 0,
        padding: 0,
        border: "none",
        outline: "none",
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      }}>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

        {ontologyLoading && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            background: theme.bgCanvas, color: theme.textUiLight, fontSize: "14px", zIndex: 1000,
          }}>
            Loading…
          </div>
        )}

        {/* HEADER — permanent element: opaque, 1px border, no shadow */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 20px", borderBottom: `1px solid ${theme.borderBezel}`, background: theme.bgPane, flexShrink: 0, transition: "background 0.3s, border-color 0.3s", position: "sticky", top: 0, zIndex: 100 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <span style={{ fontSize: "15px", fontWeight: 700, letterSpacing: "-0.2px", color: theme.textUiStrong }}>Storywright</span>
            <div style={{ display: "flex", gap: "2px", background: theme.bgCanvas, borderRadius: "5px", padding: "2px", border: `1px solid ${theme.borderBezel}` }}>
              <button onClick={() => setSurface("conversation")} style={btnStyle(surface === "conversation")}>Conversation</button>
              <button onClick={() => setSurface("workbench")} style={btnStyle(surface === "workbench")}>Workbench</button>
            </div>
            {surface === "workbench" && (
              <div style={{ display: "flex", gap: "2px" }}>
                {VIEWS.map(v => (
                  <button key={v.id} onClick={() => setView(v.id)} style={{ ...btnStyle(view === v.id), display: "flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ fontSize: "11px" }}>{v.icon}</span>{v.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button onClick={() => setShowMeta(!showMeta)} style={btnStyle(showMeta)}>Meta</button>
            <button onClick={handleNew} style={btnStyle(false)}>New</button>
            <button ref={filesButtonRef} onClick={() => setFilesMenuOpen(open => !open)} style={btnStyle(filesMenuOpen)}>Files{projects.length > 0 && <span style={{ marginLeft: "4px", color: theme.green }}>●</span>}</button>
            {undoState.past.length > 0 && (
              <button onClick={() => dispatch({ type: "UNDO" })} style={btnStyle(false)} title="Undo (Cmd+Z)">
                ↶ Undo
              </button>
            )}
            {undoState.future.length > 0 && (
              <button onClick={() => dispatch({ type: "REDO" })} style={btnStyle(false)} title="Redo (Cmd+Shift+Z)">
                ↷ Redo
              </button>
            )}
            <div style={{ width: "1px", height: "16px", background: theme.borderBezel, margin: "0 2px" }} />
            <button onClick={() => setShowApiKeyModal(true)} style={{
              ...btnStyle(false),
              position: "relative",
            }} title={apiKey ? "Change API key" : "Set API key"}>
              Settings{apiKey && <span style={{ marginLeft: "4px", color: theme.green }}>●</span>}
            </button>
            <ThemeToggle isDark={isDark} onToggle={() => setIsDark(d => !d)} />
          </div>
        </div>

        <FilesMenu
          open={filesMenuOpen}
          anchorRef={filesButtonRef}
          projects={projects}
          statusMessage={filesStatus}
          warnings={filesWarnings}
          onImport={handleImport}
          onSave={handleSaveProjectSnapshot}
          onExportCurrent={handleExport}
          onExportDualTrack={handleExportDualTrack}
          onLoadProject={handleLoadProject}
          onExportProject={handleExportProject}
          onClose={() => setFilesMenuOpen(false)}
          currentProjectTitle={currentProjectTitle}
        />

        {/* LAYER INDICATOR */}
        <div style={{ display: "flex", height: "2px", flexShrink: 0 }}>
          <div style={{ flex: 1, background: theme.yellow, opacity: layerActivity[0], transition: "opacity 0.4s" }} />
          <div style={{ flex: 1, background: theme.blue, opacity: layerActivity[1], transition: "opacity 0.4s" }} />
          <div style={{ flex: 1, background: theme.red, opacity: layerActivity[2], transition: "opacity 0.4s" }} />
        </div>

        {/* META PANEL — transient element: acrylic treatment */}
        {showMeta && (
          <div style={{
            padding: "14px 24px", borderBottom: `1px solid ${theme.borderBezel}`, flexShrink: 0,
            background: theme.acrylic, backdropFilter: theme.acrylicBlur, WebkitBackdropFilter: theme.acrylicBlur,
            boxShadow: theme.acrylicShadow, transition: "background 0.3s",
          }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px" }}>
              <div>
                <div style={{ fontSize: "9px", color: theme.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1.5px", marginBottom: "3px" }}>TITLE</div>
                <EditableText value={state.meta.title} onChange={v => dispatch({ type: "UPDATE_META", data: { title: v } })}
                  style={{ fontSize: "16px", color: theme.textWork, fontFamily: "var(--font-work)", fontWeight: 600 }} isWork placeholder="Story title" />
              </div>
              <div>
                <div style={{ fontSize: "9px", color: theme.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1.5px", marginBottom: "3px" }}>SUBTITLE</div>
                <EditableText value={state.meta.subtitle} onChange={v => dispatch({ type: "UPDATE_META", data: { subtitle: v } })}
                  style={{ fontSize: "12px", color: theme.textUi, fontFamily: "var(--font-work)", fontStyle: "italic" }} isWork placeholder="Subtitle" />
              </div>
              <div>
                <div style={{ fontSize: "9px", color: theme.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1.5px", marginBottom: "3px" }}>CORE STATEMENT</div>
                <OntologyField fieldPath="meta.coreStatement" value={state.meta.coreStatement}
                  displayValue={getDisplay('meta.coreStatement', state.meta.coreStatement)}
                  onChange={v => dispatch({ type: "UPDATE_META", data: { coreStatement: v } })}
                  style={{ fontSize: "12px", color: theme.textWork, fontFamily: "var(--font-work)" }} isWork placeholder="What this story argues" />
              </div>
              <div>
                <div style={{ fontSize: "9px", color: theme.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "1.5px", marginBottom: "3px" }}>NARRATIVE ARGUMENT</div>
                <OntologyField fieldPath="meta.narrativeArgument" value={state.meta.narrativeArgument}
                  displayValue={getDisplay('meta.narrativeArgument', state.meta.narrativeArgument)}
                  onChange={v => dispatch({ type: "UPDATE_META", data: { narrativeArgument: v } })}
                  style={{ fontSize: "12px", color: theme.textUi, fontFamily: "var(--font-work)" }} isWork placeholder="The argument in fuller form" />
              </div>
            </div>
          </div>
        )}

        {/* API KEY MODAL */}
        {showApiKeyModal && (
          <ApiKeyModal
            initialKey={apiKey}
            onSave={handleSaveApiKey}
            onCancel={() => {
              setShowApiKeyModal(false);
              if (!apiKey) {
                setSurface("workbench");
              }
            }}
          />
        )}

        {/* MAIN CONTENT */}
        <div style={{ 
          display: "flex", 
          flex: 1, 
          overflow: "hidden", 
          paddingLeft: "clamp(40px, 10vw, 200px)",
          paddingRight: "0",
          minWidth: "1200px",
          boxSizing: "border-box"
        }}>
          <div style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
            {surface === "conversation" && <ConversationPane state={state} dispatch={dispatch} messages={messages} setMessages={setMessages} apiKey={apiKey} />}
            {surface === "workbench" && view === "constellation" && <ConstellationView state={state} selectedEntity={selectedEntity} onSelectEntity={handleSelectEntity} selectedPrinciple={selectedPrinciple} onSelectPrinciple={handleSelectPrinciple} />}
            {surface === "workbench" && view === "tension" && <TensionWeb state={state} selectedEntity={selectedEntity} onSelectEntity={handleSelectEntity} getDisplay={getDisplay} />}
            {surface === "workbench" && view === "arc" && <ArcTimeline state={state} selectedEntity={selectedEntity} onSelectEntity={handleSelectEntity} dispatch={dispatch} getDisplay={getDisplay} />}
            {surface === "workbench" && view === "layers" && <LayerMap state={state} onSelectEntity={handleSelectEntity} onSelectPrinciple={handleSelectPrinciple} dispatch={dispatch} getDisplay={getDisplay} />}
            {surface === "workbench" && view === "coherence" && <CoherenceView state={state} />}
            {surface === "workbench" && view === "compendium" && <CompendiumView state={state} dispatch={dispatch} onSelectEntity={handleSelectEntity} getDisplay={getDisplay} />}
          </div>

          {/* INSPECTOR — permanent element: opaque, 1px border */}
          <div style={{ width: "300px", borderLeft: `1px solid ${theme.borderBezel}`, background: theme.bgPane, overflow: "hidden", flexShrink: 0, display: "flex", flexDirection: "column", transition: "background 0.3s, border-color 0.3s" }}>
            <div style={{ padding: "10px 16px", borderBottom: `1px solid ${theme.borderBezel}`, flexShrink: 0 }}>
              <span style={{ fontSize: "10px", color: theme.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "2px" }}>INSPECTOR</span>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              <Inspector state={state} selectedEntity={selectedEntity} selectedPrinciple={selectedPrinciple}
                dispatch={dispatch} onSelectEntity={handleSelectEntity} onSelectPrinciple={handleSelectPrinciple} getDisplay={getDisplay} />
            </div>
          </div>
        </div>

        {/* STATUS BAR — permanent element: opaque, 1px border */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "4px 20px", borderTop: `1px solid ${theme.borderBezel}`, background: theme.bgPane,
          fontSize: "10px", color: theme.textUiLight, fontFamily: "var(--font-ui)", fontWeight: 500, flexShrink: 0,
          transition: "background 0.3s, border-color 0.3s",
          position: "sticky", bottom: 0, zIndex: 100,
        }}>
          <div style={{ display: "flex", gap: "16px" }}>
            <span><span style={{ color: theme.yellow }}>●</span> {state.principles.length}p</span>
            <span><span style={{ color: theme.blue }}>●</span> {state.entities.length}e</span>
            <span><span style={{ color: theme.red }}>●</span> {state.expressions.length}x</span>
            <span>⬡ {state.relationships.length}r</span>
            <span>▸ {state.acts.length}a</span>
            {undoState.past.length > 0 && <span>↶ {undoState.past.length}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ color: theme.textUi, letterSpacing: "0.2px" }}>{filesStatus}</span>
            <span style={{ letterSpacing: "0.3px" }}>storywright v0.5</span>
          </div>
        </div>
      </div>
    </ThemeCtx.Provider>
  );
}
