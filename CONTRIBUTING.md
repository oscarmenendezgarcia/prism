# Contributing to Prism

Thanks for your interest in contributing.

## Before you start

- Open an issue before working on a significant change — it avoids duplicate effort and lets us align on approach
- For small fixes (typos, docs, obvious bugs) you can go straight to a PR

## Setup

**Prerequisites:** Node.js ≥ 18 and build tools for `node-pty` (see README).

```bash
git clone https://github.com/oscarmenendezgarcia/prism.git
cd prism
npm install
cd frontend && npm install && cd ..
node server.js &
cd frontend && npm run dev   # → http://localhost:5173
```

## Making changes

1. Fork the repo and create a branch: `git checkout -b feature/your-thing`
2. Make your changes
3. Run the tests:
   ```bash
   npm test                    # backend
   cd frontend && npm test     # frontend
   ```
4. Open a PR against `main` — squash merge is used, so keep the PR focused

## Design system

UI changes must follow the design system defined in `frontend/tailwind.config.js` and `frontend/src/index.css`. No inline styles — Tailwind tokens only. See `CLAUDE.md` for the full rules.

## Reporting bugs

Use the [bug report template](https://github.com/oscarmenendezgarcia/prism/issues/new?template=bug_report.md).
