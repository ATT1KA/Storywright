const DEFAULT_LABEL_WORD_COUNT = 6;
const DEFAULT_MAX_CHARS = 120;
const IDENTITY_KEYS = ['label', 'name', 'title', 'id'];

const STRATEGIES = {
  truncate(value, cfg) {
    const text = toText(value);
    const maxChars = cfg.maxChars ?? DEFAULT_MAX_CHARS;
    if (!text || text.length <= maxChars) return text;
    const slice = text.slice(0, maxChars);
    const boundary = slice.lastIndexOf(' ');
    const candidate = boundary > maxChars * 0.6 ? slice.slice(0, boundary) : slice;
    return (candidate || slice).trimEnd() + '…';
  },

  first_sentence(value, cfg) {
    const text = toText(value);
    if (!text) return null;
    const match = text.match(/([\s\S]+?[.!?])(?=\s|$)/);
    if (!match) return null;
    const sentence = match[0].trim();
    return sentence.length <= (cfg.maxChars ?? DEFAULT_MAX_CHARS)
      ? sentence
      : STRATEGIES.truncate(sentence, cfg);
  },

  first_clause(value, cfg) {
    const text = toText(value);
    if (!text) return null;
    const splitIdx = text.search(/\s[—:;]\s/);
    if (splitIdx === -1) return null;
    const clause = text.slice(0, splitIdx).trim();
    if (!clause) return null;
    return clause.length <= (cfg.maxChars ?? DEFAULT_MAX_CHARS)
      ? clause
      : STRATEGIES.truncate(clause, cfg);
  },

  label_extract(value, cfg) {
    const text = toText(value);
    if (!text) return null;
    const words = text.trim().split(/\s+/);
    if (words.length === 0) return null;
    const count = cfg.labelWordCount || DEFAULT_LABEL_WORD_COUNT;
    const label = words.slice(0, count).join(' ');
    return label.length <= (cfg.maxChars ?? DEFAULT_MAX_CHARS)
      ? label
      : STRATEGIES.truncate(label, cfg);
  },

  key_value_head(value, cfg) {
    const obj = toObject(value);
    if (!obj) return null;
    const entries = Object.entries(obj);
    if (entries.length === 0) return null;
    const maxLines = Math.max(1, cfg.maxLines || 2);
    const selected = entries.slice(0, maxLines);
    return selected
      .map(([key, val]) => `${key}: ${summarizeValue(val, cfg)}`)
      .join('\n');
  },

  array_head(value, cfg) {
    const arr = toArray(value);
    if (!arr || arr.length === 0) return null;
    const maxLines = Math.max(1, cfg.maxLines || 3);
    const perLine = Math.max(8, Math.floor((cfg.maxChars ?? DEFAULT_MAX_CHARS) / maxLines));
    return arr.slice(0, maxLines)
      .map(item => STRATEGIES.truncate(toText(item), { ...cfg, maxChars: perLine }))
      .join('\n');
  },

  identity_only(value, cfg) {
    const obj = toObject(value);
    if (!obj) return null;
    const keys = [cfg.identityKey, ...IDENTITY_KEYS].filter(Boolean);
    for (const key of keys) {
      if (obj[key]) {
        const label = toText(obj[key]);
        if (label) {
          return STRATEGIES.label_extract(label, cfg) || label;
        }
      }
    }
    return null;
  },
};

function toText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(toText).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return '';
}

function toObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function toArray(value) {
  return Array.isArray(value) ? value : null;
}

function summarizeValue(value, cfg) {
  return (
    STRATEGIES.first_clause(value, cfg) ||
    STRATEGIES.first_sentence(value, cfg) ||
    STRATEGIES.truncate(value, cfg)
  );
}

function runStrategy(name, canonical, cfg) {
  const fn = STRATEGIES[name];
  if (!fn) return null;
  const result = fn(canonical, cfg);
  if (typeof result === 'string') {
    const trimmed = result.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return result;
}

export function clampField(canonical, config = {}) {
  const strategyName = config.clamp_strategy || 'truncate';
  const primary = runStrategy(strategyName, canonical, config);
  if (primary) return primary;
  const fallbackName = config.clamp_fallback || 'truncate';
  if (fallbackName !== strategyName) {
    const fallback = runStrategy(fallbackName, canonical, config);
    if (fallback) return fallback;
  }
  return STRATEGIES.truncate(canonical, config) || '';
}

export function getStrategyNames() {
  return Object.keys(STRATEGIES);
}
