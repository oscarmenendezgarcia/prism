# Prism — Installation Guide

This guide covers the one-liner installer, what it does, and how to verify the result.

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Node.js ≥ 20** | Installed automatically by the one-liner if missing |
| **curl** or **wget** | Used to download nvm if Node.js needs to be installed |
| **Internet access** | Required to fetch nvm and the npm package |
| **Unix-like shell** | macOS, Linux, or WSL on Windows |

> **Windows (native):** The one-liner requires a POSIX shell. Use WSL or install Node.js ≥ 20 manually from [nodejs.org](https://nodejs.org), then run `npm install -g prism-kanban && prism init`.

---

## One-liner

```bash
curl -fsSL https://raw.githubusercontent.com/oscarmenendezgarcia/prism/main/install.sh | sh
```

### What it does — step by step

| Step | Action |
|------|--------|
| 1 | Sources `~/.nvm/nvm.sh` if it exists (picks up an already-installed nvm) |
| 2 | Checks `node --version`; if missing or < 20, continues to step 3 |
| 3 | Downloads and runs the [nvm installer](https://github.com/nvm-sh/nvm) |
| 4 | Runs `nvm install --lts && nvm use --lts && nvm alias default lts/*` |
| 5 | Runs `npm install -g prism-kanban` |
| 6 | Runs `prism init` (see below) |
| 7 | Prints the post-install usage hint |

### Passing extra flags to `prism init`

When piped via `curl | sh`, use `sh -s --` to forward arguments:

```bash
curl -fsSL https://raw.githubusercontent.com/oscarmenendezgarcia/prism/main/install.sh | sh -s -- --data-dir /custom/path
curl -fsSL https://raw.githubusercontent.com/oscarmenendezgarcia/prism/main/install.sh | sh -s -- --force
```

---

## What `prism init` creates

`prism init` is idempotent — safe to run multiple times.

### Data directory

The data directory is resolved in this order:

| Source | Example |
|--------|---------|
| `--data-dir <path>` flag | `/custom/path` |
| `DATA_DIR` environment variable | `$DATA_DIR` |
| Global npm install | `~/.prism/data/` |
| Local clone | `./data/` (alongside `server.js`) |

Inside the data directory:

```
~/.prism/data/          (or your custom path)
└── settings.json       ← created if absent (or overwritten with --force)
```

### `settings.json` defaults

```json
{
  "pipeline": {
    "agentsDir":    "~/.claude/agents",
    "timeout":      600000,
    "maxConcurrent": 5
  },
  "ui": {
    "theme": "dark"
  }
}
```

| Field | Description |
|-------|-------------|
| `pipeline.agentsDir` | Directory where agent `.md` files live (Claude Code convention) |
| `pipeline.timeout` | Kill timeout per pipeline stage in ms (default 10 min) |
| `pipeline.maxConcurrent` | Max simultaneous pipeline runs |
| `ui.theme` | UI theme (`dark` or `light`) |

> `prism init` does **not** touch `~/.claude/settings.json` or `~/.claude/agents/` — those are managed by Claude Code itself.

---

## Post-installation: basic usage

```bash
# Start the Prism server (default port 3000)
prism start

# Start on a custom port
prism start --port 8080

# Start with a custom data directory
prism start --data-dir /custom/path

# Re-initialise (reset settings.json)
prism init --force

# Print version
prism --version

# Print all commands and flags
prism --help
```

Open the board at **http://localhost:3000**.

---

## Keeping nvm on PATH

The installer sources nvm for the current shell session. To make it permanent, add this to your shell profile (`~/.bashrc`, `~/.zshrc`, or `~/.profile`):

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
```

---

## Updating Prism

```bash
npm install -g prism-kanban@latest
```

`prism init` does not need to be re-run after updates unless the release notes say otherwise.

---

## Uninstalling

```bash
npm uninstall -g prism-kanban
rm -rf ~/.prism          # remove data directory (if using the default global path)
```

---

## Troubleshooting

### `prism: command not found` after install

The npm global bin directory may not be on your `PATH`. Find it and add it:

```bash
npm prefix -g         # prints something like /Users/you/.nvm/versions/node/v22.x.x
export PATH="$(npm prefix -g)/bin:$PATH"
```

Add the `export` line to your shell profile to make it permanent.

### Node.js installed via nvm but not picked up in new terminals

Add the nvm source lines to your shell profile (see *Keeping nvm on PATH* above), then restart your terminal.

### `node-gyp` / native build errors during `npm install -g prism-kanban`

Prism depends on `better-sqlite3` and `node-pty`, both of which require native compilation.

| OS | Fix |
|----|-----|
| macOS | `xcode-select --install` |
| Ubuntu/Debian | `sudo apt install build-essential python3` |
| RHEL/Fedora | `sudo dnf groupinstall "Development Tools"` |
| Windows (WSL) | `sudo apt install build-essential python3` |

Then retry `npm install -g prism-kanban`.
