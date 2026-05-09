# Storywright QA Report

A full-project QA sweep covering installation, routing, component wiring, design consistency, usability, and build health. Anything fixed inline is marked **Fixed**; remaining items list a recommended next step.

**Sweep performed against:** branch `claude/adoring-roentgen-32ed4f`
**Toolchain:** Node v25.2.1, npm 11.6.2, Vite 5.4.21

## Summary

- **Tests:** 62/62 pass across all three suites (clamp, validate, context-budget).
- **Build:** clean, ~299 KB bundled (~87 KB gzip), no warnings.
- **Dev server:** boots in ~100 ms, default ontology fetches successfully.
- **Critical issues:** none found.
- **Major issues:** 1 fixed, 0 outstanding.
- **Minor issues:** 6 fixed, 4 outstanding (low impact, documented below).

---

## Installation & Tooling

| Item | Severity | Status | Notes |
| --- | --- | --- | --- |
| One-command setup | minor | **Fixed** | Added `scripts/setup.sh` (prereq checks + install + sanity check) plus `npm run setup` and `make setup` aliases. |
| `npm test` aggregator | minor | **Fixed** | Added top-level `npm test` that chains `test:clamp`, `test:validate`, `test:context-budget`. |
| `npm start` alias | minor | **Fixed** | Added `npm start` as an alias for `vite` (developers reach for `start` reflexively). |
| Common-command surface | minor | **Fixed** | Added `Makefile` covering `setup/install/dev/build/preview/test/validate/clean/reset` with `make help` as a discovery surface. |
| Engines field | minor | **Fixed** | Added `"engines": { "node": ">=18" }` to `package.json` so `npm` warns on too-old Node. |
| Description field | minor | **Fixed** | `package.json` now has a one-line `description`. |
| `.env.example` clarity | minor | **Fixed** | Rewrote with explicit guidance — no env vars are required, the file exists for completeness, and the unused `VITE_ANTHROPIC_API_KEY` is now clearly labelled as not consumed. |
| README getting-started | minor | **Fixed** | Replaced with a one-command setup section, a npm/make command table, and clearer feature/structure sections. |
| `npm audit` (dev only) | minor | **Partially fixed** | `npm audit fix` cleared the postcss advisory. The remaining two advisories (esbuild ≤0.24.2, vite ≤6.4.1) only fix via `npm audit fix --force`, which would push Vite to a major (5 → 8) and risks regressions. They are dev-only (esbuild dev server) and not present in the production bundle — left as-is, recommended to upgrade Vite intentionally in a separate PR. |

## Routing / Surface Wiring

The app has no router — it uses two top-level `surface` modes (`conversation` / `workbench`) and six `view` IDs inside the workbench. All wiring verified by reading [storywright.jsx:3488-3494](storywright.jsx:3488):

| Surface / View | Component | Wired? |
| --- | --- | --- |
| `conversation` | `ConversationPane` | ✓ |
| `workbench` / `constellation` | `ConstellationView` | ✓ |
| `workbench` / `tension` | `TensionWeb` | ✓ |
| `workbench` / `arc` | `ArcTimeline` | ✓ |
| `workbench` / `layers` | `LayerMap` | ✓ |
| `workbench` / `coherence` | `CoherenceView` | ✓ |
| `workbench` / `compendium` | `CompendiumView` | ✓ |

All six view IDs in `VIEWS` ([storywright.jsx:3032](storywright.jsx:3032)) match a render branch. No dead routes.

## Component Wiring & Imports

| Item | Severity | Status | Notes |
| --- | --- | --- | --- |
| Unused import `hasFileSystemAccess` | minor | **Fixed** | Removed from [storywright.jsx:8](storywright.jsx:8). |
| `handleClearApiKey` defined but never reachable from UI | minor | **Fixed** | Wired to `ApiKeyModal` via a new `onClear` prop; renders a "Clear stored key" button when an existing key is present ([storywright.jsx:2989-3008](storywright.jsx:2989)). Also fixed the handler to close the modal after clearing instead of re-opening it ([storywright.jsx:3128-3136](storywright.jsx:3128)). |
| Stale model ID `claude-sonnet-4-20250514` | minor | **Fixed** | Updated to `claude-sonnet-4-5`, the current Sonnet 4.5 model ID ([storywright.jsx:1849](storywright.jsx:1849)). |
| `useT` defined and widely used | — | OK | All `useT()` callers wrap inside `<ThemeCtx.Provider>` — no orphan calls. |
| Console output | minor | OK | All `console.error/warn` calls are inside `catch` blocks for genuine error paths — no debug `console.log` leftovers found. |

## Design Consistency

| Item | Severity | Status | Notes |
| --- | --- | --- | --- |
| Inconsistent icon style for Compendium view | minor | **Fixed** | The Compendium nav button used a 📖 emoji while every other view uses a Unicode geometric glyph (◎, ⬡, ▸, ≡, ◈). Replaced with `▤` for visual coherence ([storywright.jsx:3039](storywright.jsx:3039)). |
| Theme tokens (`LIGHT` / `DARK`) | — | OK | Both palettes define identical keys — no missing tokens, both sets cover canvas/pane/text/border/accent/acrylic/tension. |
| Font system | — | OK | Two CSS variables (`--font-ui` Inter, `--font-work` Charter/Georgia). Used consistently. |
| Acrylic treatment | — | OK | Used only on transient surfaces (modals, menus) per the explicit comment convention; permanent chrome (header, status bar, inspector) is opaque with 1px borders. Consistent. |
| `dist/` artifacts | — | OK | Build is reproducible; only `dist/index.html` and one JS chunk emitted. |

## Usability

| Item | Severity | Status | Notes |
| --- | --- | --- | --- |
| App locked to ≥1200 px viewports | **major** | **Fixed** | The root container and the main content row both had hard `minWidth: 1200px`. Anything narrower (e.g. a 13" laptop in a non-fullscreen window) caused horizontal scrolling on every surface. Removed the constraint from the root ([storywright.jsx:3331](storywright.jsx:3331)) and from the content row ([storywright.jsx:3478](storywright.jsx:3478)); content row left padding tightened from `clamp(40px, 10vw, 200px)` to `clamp(20px, 8vw, 200px)` so narrower viewports don't waste a third of the width on side gutter. |
| First-run onboarding | — | OK | API-key modal auto-opens on first visit when the conversation surface is active ([storywright.jsx:3074-3078](storywright.jsx:3074)). Cancelling the modal flips to the workbench so the user is never trapped at a blocked screen. |
| Empty states | — | OK | Each visualization view has a graceful empty state: ConstellationView ([storywright.jsx:2130](storywright.jsx:2130)), TensionWeb ([storywright.jsx:2253](storywright.jsx:2253)), ArcTimeline ([storywright.jsx:2320](storywright.jsx:2320)), CoherenceView ([storywright.jsx:2480](storywright.jsx:2480)). LayerMap and CompendiumView render their "+ Add" affordances even when empty. |
| Loading states | — | OK | Top-level `Loading…` overlay during the initial ontology fetch ([storywright.jsx:3349](storywright.jsx:3349)); ConversationPane shows a "Claude is thinking…" pulse while streaming and a streaming caret on partial text. |
| Error states | — | OK | API errors map to specific messages (401/403 → "Invalid API key"); stream errors append to partial text with `[stream error: …]`; network failures preserve any partial response and show "[connection interrupted]". |
| Streaming UX | — | OK | SSE parser handles `content_block_delta`, `message_delta`, and `error` events; reuses the placeholder-index pattern to mutate the assistant message in place. |
| Token-budget meter | — | OK | Live estimate as the user types, plus "trimmed N earlier messages" notice when the sliding window dropped history. |
| Keyboard shortcuts | — | OK | Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Cmd/Ctrl+S, Cmd/Ctrl+O all wired ([storywright.jsx:3134-3143](storywright.jsx:3134)) and surfaced via `title=` tooltips on the Undo/Redo buttons. |
| Save-to-disk fallback | — | OK | `filePersistence.js` falls back from File System Access API to a hidden file input on Firefox/Safari. Both paths exercised by the in-app Files menu. |

## Hardcoded values & content hygiene

| Item | Severity | Status | Notes |
| --- | --- | --- | --- |
| TODO / FIXME / XXX / HACK markers | — | OK | None present in `storywright.jsx`, `src/`, or `scripts/`. |
| Placeholder text that shipped | — | OK | All `placeholder=` attributes are intentional UI affordances ("click to edit", "Describe your idea…", "sk-ant-…", etc.), not leftover lorem-ipsum. |
| Stray top-level file `REVERENCE_II-Story_Bible` | minor | **Outstanding** | A 295 KB extension-less JSON file sits at the repo root. It's near-identical to `public/data/ontologies/reverence-ii.json` (sizes 294,973 vs 294,932) but was committed deliberately (commit 725fd75 "Track REVERENCE_II-Story_Bible source file"). Recommend either renaming it to `.json` and moving under `public/data/ontologies/` or moving it to a `samples/` folder — leaving as-is to avoid removing data the author wanted tracked. |
| Default ontology path absolute | minor | **Outstanding** | `DEFAULT_ONTOLOGY_PATH = "/data/ontologies/morrow-doctrine.json"` ([storywright.jsx:263](storywright.jsx:263)) is an absolute URL — works on the root deployment that Vercel produces but breaks if the app is mounted at a sub-path. Low impact for current deployment target; would require Vite `base` configuration if that changes. |
| Files-menu position | minor | **Outstanding** | The Files dropdown is positioned absolutely at `top: 58px, right: 24px` ([storywright.jsx:1437-1439](storywright.jsx:1437)). Functional and stable today because the header height is fixed, but if the header padding ever changes the menu will drift. Better long-term: anchor to `filesButtonRef` via `getBoundingClientRect()`. |

## Accessibility

| Item | Severity | Status | Notes |
| --- | --- | --- | --- |
| Color contrast | — | OK | Light theme `textUiStrong #171717` on `bgPane #FFFFFF` ≈ 18:1; dark theme `textUiStrong #E8E8E8` on `bgPane #1A1A1A` ≈ 12:1. Both well above WCAG AA. |
| Keyboard support | — | OK | All buttons are real `<button>` elements; the textarea uses `Enter` to send and `Shift+Enter` for newline; Escape cancels editable fields and the inspector modal. |
| Theme toggle accessibility | — | OK | Has a `title` ("Switch to light/dark mode"). |
| Icon-only buttons | minor | **Outstanding** | Several icon-only affordances (the `↶ Undo` / `↷ Redo` buttons, the small `×` close on arc beats, etc.) rely on Unicode glyphs without ARIA labels. Screen-reader users would hear the raw glyph rather than a description. Low impact for this prototype but worth adding `aria-label`s before any production-grade release. |

## Re-verification

After the above changes:

```
$ npm test
…
test:clamp           → All clamp tests passed.
test:validate        → 20 passed, 0 failed.
test:context-budget  → 41 passed, 0 failed.

$ npm run build
✓ 42 modules transformed.
dist/index.html                  0.90 kB │ gzip:  0.39 kB
dist/assets/index-OFIzTpKC.js  299.06 kB │ gzip: 87.42 kB
✓ built in 412ms

$ npm run dev   # served HTML 200, default ontology JSON 200
```

No regressions introduced.
