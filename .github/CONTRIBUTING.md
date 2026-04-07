# Contributing to Prism

Thanks for your interest in contributing!

## Prerequisites

- Node.js ≥ 18
- For the terminal feature (`node-pty`): build tools required
  - macOS: `xcode-select --install`
  - Linux: `sudo apt install build-essential python3`
  - Windows: `npm install --global windows-build-tools`

## Setup

```bash
# Install backend dependencies
npm install

# Install and build frontend
cd frontend && npm install && npm run build && cd ..

# Install MCP server dependencies
cd mcp && npm install && cd ..

# Start the server
node server.js  # → http://localhost:3000
```

## Development mode

```bash
node server.js &
cd frontend && npm run dev  # → http://localhost:5173
```

## Running tests

```bash
# Backend tests
npm test

# Frontend tests
cd frontend && npm test
```

## Code conventions

- **Backend:** Node.js native HTTP, no frameworks. Follow the module layout in `server.js` header.
- **Frontend:** React 19 + TypeScript strict mode + Tailwind CSS. See design system rules in `CLAUDE.md`.
- **No inline styles** — use Tailwind tokens only (`bg-surface`, `text-primary`, etc.).
- **Shared components** live in `frontend/src/components/shared/` — reuse before creating new ones.
- **Tests required** for new backend handlers and frontend components.

## Submitting a PR

1. Fork the repo and create a branch: `feature/<kebab-name>` or `fix/<kebab-name>`
2. Make your changes with tests
3. Run the full test suite (`npm test` + `cd frontend && npm test`)
4. Open a PR against `main` with a clear description of what and why

## Architecture

See `docs/architecture.md` for the full system design and data model.
API reference: `docs/endpoints.md`
MCP tools reference: `docs/mcp-server.md`
