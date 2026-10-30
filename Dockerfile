# ============================================================
# Stage 1 — builder
# Compiles node-pty native bindings and builds the React frontend.
# ============================================================
FROM node:20-alpine AS builder

# node-pty and better-sqlite3 require Python 3, make, and g++ for native
# compilation via node-gyp.
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install backend dependencies (including node-pty, compiled from source).
# The package's own lifecycle hooks cannot run at this point: `prepare` builds
# the frontend (not copied yet). So: install with scripts disabled and compile the
# native deps via `npm rebuild`. The frontend is built in its own step below.
COPY package.json package-lock.json* ./
COPY bin/ ./bin/
RUN npm install --ignore-scripts \
 && npm rebuild --build-from-source better-sqlite3

# Install frontend dependencies and build the Vite/React app.
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm install

COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Install MCP server dependencies (separate sub-package).
COPY mcp/package.json mcp/package-lock.json* ./mcp/
RUN cd mcp && npm install

# Copy the rest of the source needed at runtime.
COPY server.js ./
COPY src/ ./src/
COPY agents/ ./agents/
COPY mcp/ ./mcp/

# ============================================================
# Stage 2 — runtime
# Minimal image: only production artifacts, no build tools.
# ============================================================
FROM node:20-alpine AS runtime

# better-sqlite3 needs python3/make/g++ only at build time. The SQLite library is
# statically linked into it. Agents work in git worktrees and open pull requests with gh.
RUN apk add --no-cache git github-cli

WORKDIR /app

# Copy compiled backend node_modules.
COPY --from=builder /app/node_modules ./node_modules

# Copy application source.
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/src/ ./src/
COPY --from=builder /app/agents/ ./agents/
COPY --from=builder /app/mcp/ ./mcp/
COPY --from=builder /app/mcp/node_modules ./mcp/node_modules
COPY --from=builder /app/package.json ./package.json

# Copy built frontend (served as static files in production).
COPY --from=builder /app/dist/ ./dist/

# data/ is intentionally NOT copied — it is mounted as a volume at runtime
# so that board state persists across container restarts.

# ── Environment variable defaults (all overridable via docker-compose or -e) ──
ENV PORT=3000
ENV PRISM_HOST=0.0.0.0
ENV DATA_DIR=/app/data
ENV ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

EXPOSE $PORT

# Install Claude Code CLI so agents can run inside the container.
RUN npm install -g @anthropic-ai/claude-code


# Ensure the data directory exists even when the volume is not yet mounted.
# The volume mount will overlay this directory at runtime.
RUN mkdir -p /app/data

CMD ["node", "server.js"]
