# Storywright

A collaborative story development environment where a human and an LLM build stories together through conversation, with an ontological storage layer and visualization/manipulation surfaces.

## Quick Start

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

3. Open your browser to the URL shown (typically `http://localhost:5173`)

4. Enter your Anthropic API key when prompted (or click "Settings" in the header)

### Getting an Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up or log in
3. Navigate to API Keys section
4. Create a new API key
5. Copy the key and paste it into Storywright when prompted

**Important:** Your API key is stored locally in your browser's localStorage. It never leaves your device.

### Building for Production

```bash
npm run build
```

The built files will be in the `dist/` directory.

### Deploying to Vercel

1. Push your code to a GitHub repository
2. Go to [vercel.com](https://vercel.com) and sign in
3. Click "New Project"
4. Import your GitHub repository
5. Vercel will auto-detect the Vite configuration
6. Click "Deploy"

No environment variables need to be configured - users will enter their API keys through the UI.

## Features

- **Conversation Surface**: Collaborate with an LLM on story development
- **Workbench**: Five visualization/editing views (Constellation, Tension Web, Arc Timeline, Layer Map, Coherence)
- **Inspector**: Context-sensitive property editor
- **Dark Mode**: Full dual-theme support
- **Undo/Redo**: 50-step history with keyboard shortcuts (Cmd+Z / Cmd+Shift+Z)
- **Export/Import**: JSON-based project persistence

## Project Status

v0.5 - Fully functional prototype. Ready for demo deployment.

## License

See project documentation for details.
