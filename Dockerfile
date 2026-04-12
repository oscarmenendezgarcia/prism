# ============================================================
# Stage 1 — builder
# Compiles node-pty native bindings and builds the React frontend.
# ============================================================
FROM node:20-alpine AS builder

# node-pty requires Python 3, make, and g++ for native compilation via node-gyp.
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install backend dependencies (including node-pty, compiled from source).
COPY package.json package-lock.json* ./
RUN npm install --build-from-source

# Install frontend dependencies and build the Vite/React app.
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm install

COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Install MCP server dependencies (separate sub-package).
COPY mcp/package.json mcp/package-lock.json* ./mcp/
RUN cd mcp && npm install

# Copy the rest of the source needed at runtime.
COPY server.js terminal.js ./
COPY src/ ./src/
COPY mcp/ ./mcp/

# ============================================================
# Stage 2 — runtime
# Minimal image: only production artifacts, no build tools.
# ============================================================
FROM node:20-alpine AS runtime

# node-pty native bindings need python3/make/g++ only at build time.
# At runtime only the compiled .node file is required — no extra OS deps.

WORKDIR /app

# Copy compiled backend node_modules (includes pre-built node-pty .node file).
COPY --from=builder /app/node_modules ./node_modules

# Copy application source.
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/terminal.js ./terminal.js
COPY --from=builder /app/src/ ./src/
COPY --from=builder /app/mcp/ ./mcp/
COPY --from=builder /app/mcp/node_modules ./mcp/node_modules
COPY --from=builder /app/package.json ./package.json

# Copy built frontend (served as static files in production).
COPY --from=builder /app/dist/ ./dist/

# data/ is intentionally NOT copied — it is mounted as a volume at runtime
# so that board state persists across container restarts.

# ── Environment variable defaults (all overridable via docker-compose or -e) ──
ENV PORT=3000
ENV DATA_DIR=/app/data
ENV ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

EXPOSE $PORT

# Install Claude Code CLI so agents can run inside the container.
RUN npm install -g @anthropic-ai/claude-code

# Pre-load the pipeline agents so they are available without mounting the host ~/.claude/agents/.
RUN mkdir -p /root/.claude/agents
COPY agents/ /root/.claude/agents/

# Ensure the data directory exists even when the volume is not yet mounted.
# The volume mount will overlay this directory at runtime.
RUN mkdir -p /app/data

CMD ["node", "server.js"]
