# Storywright

A collaborative story development environment where a human and an LLM build stories together through conversation, backed by an ontological storage layer with deterministic visualization and editing surfaces.

## Quick Start

### Prerequisites

- **Node.js 18+** ([install](https://nodejs.org) or `brew install node`)
- **npm** (ships with Node)
- **An Anthropic API key** for the conversation features ([console.anthropic.com](https://console.anthropic.com)) — entered in-app, stored only in your browser

### One-command setup

```bash
npm run setup
```

This checks prerequisites, installs dependencies, and verifies the install. Equivalent: `bash scripts/setup.sh` or `make setup`.

### First run

```bash
npm run dev
```

Open the URL it prints (typically `http://localhost:5173`).

On first launch the app prompts for your Anthropic API key. The key is stored in `localStorage` on your device and only ever sent to `api.anthropic.com`. You can dismiss the prompt and use the Workbench surfaces to edit the ontology directly without an API key.

## Common commands

The project ships a `Makefile` and matching `npm` scripts. Pick whichever you prefer.

| Task | npm | make |
| --- | --- | --- |
| Set up from scratch | `npm run setup` | `make setup` |
| Start the dev server | `npm run dev` | `make dev` |
| Build for production | `npm run build` | `make build` |
| Preview the production build | `npm run preview` | `make preview` |
| Run all tests | `npm test` | `make test` |
| Validate constraint registry | `npm run validate:bible` | `make validate` |
| Remove `dist/` | — | `make clean` |
| Wipe `dist/` and `node_modules/` | — | `make reset` |

Run `make help` to see the full list with descriptions.

## Configuration

Storywright is configured entirely in-app — there are no required environment variables for local development or deployment. See [.env.example](.env.example) if you want to wire an API key for tests or automated runs (the in-app prompt is the recommended path).

## Project structure

```
storywright.jsx              Main application (single React component, ~3.5k lines)
src/
  main.jsx                   Vite entry point
  ontology/                  Ontology data model, validators, clamp/display logic
  persistence/               File System Access API persistence helpers
scripts/
  setup.sh                   One-command setup
  test-*.js                  Test runners (no test framework dependency)
  validate-bible.js          Constraint-registry validator
public/data/ontologies/      Sample ontologies loaded at startup
docs/                        Format documentation
```

## Features

- **Conversation Surface** — collaborate with an LLM that proposes additions/edits to your ontology, with per-proposal accept/decline.
- **Workbench** — six visualization/editing views: Constellation, Tension Web, Arc Timeline, Layer Map, Coherence, Compendium.
- **Inspector** — context-sensitive property editor for any selected entity, principle, relationship, or expression.
- **Dual-track text** — every authored field has a canonical (full prose for the LLM) and a derived display (deterministically clamped to the UI surface).
- **Undo/Redo** — 50-step history (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z).
- **File persistence** — Save to disk (Cmd/Ctrl+S), Open from disk (Cmd/Ctrl+O), or use the in-browser Files menu for local snapshots.
- **Dark/light mode** — toggle in the header.

## Deploying

### Vercel

The repo includes a `vercel.json` and Vite is auto-detected.

1. Push to GitHub, GitLab, or Bitbucket.
2. Import the repo at [vercel.com](https://vercel.com).
3. Click Deploy. No environment variables required — users enter their own API key.

### Static host

`npm run build` produces a fully static bundle in `dist/`. Drop it on any static host (Netlify, Cloudflare Pages, S3+CloudFront, etc.). Nothing on the server needs to know about Anthropic.

## Project status

v0.5 — fully functional prototype, ready for demo deployment.

## License

See project documentation for details.
