#!/usr/bin/env node
/**
 * seed-demo.js — Populate a Prism instance with realistic demo data for screenshots/GIFs.
 *
 * Usage:
 *   node scripts/seed-demo.js [BASE_URL]
 *
 * Examples:
 *   node scripts/seed-demo.js                        # → http://localhost:3000
 *   node scripts/seed-demo.js http://localhost:3001  # → Docker demo instance
 */

const BASE_URL = process.argv[2]?.replace(/\/$/, '') ?? 'http://localhost:3000';
const API = `${BASE_URL}/api/v1`;

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function put(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function createSpace(name) {
  const space = await post('/spaces', { name });
  console.log(`  ✓ space "${name}" → ${space.id}`);
  return space;
}

async function createTask(spaceId, task) {
  const t = await post(`/spaces/${spaceId}/tasks`, task);
  return t;
}

async function moveTask(spaceId, taskId, to) {
  await put(`/spaces/${spaceId}/tasks/${taskId}/move`, { to });
}

// ─── Demo data ───────────────────────────────────────────────────────────────

const SPACES = [
  {
    name: 'Frontend',
    tasks: {
      todo: [
        { title: 'Add skeleton loading states to task cards', type: 'feature', description: 'Replace empty column placeholders with animated skeletons while tasks load. Use CSS-only animation to avoid layout shift.', assigned: 'developer-agent' },
        { title: 'Keyboard shortcut: open task detail with Enter', type: 'feature', description: 'When a task card is focused, pressing Enter should open the TaskDetailPanel. Follows ARIA listbox pattern.' },
        { title: 'Empty state illustration for new spaces', type: 'feature', description: 'Show a friendly empty-state graphic when a space has no tasks yet. SVG inline, respects dark/light mode.' },
      ],
      'in-progress': [
        { title: 'Responsive layout for narrow viewports', type: 'tech-debt', description: 'The board currently breaks below 768px. Implement a single-column view with a tab bar for columns on mobile.', assigned: 'developer-agent' },
        { title: 'Fix drag-and-drop ghost offset on retina screens', type: 'bug', description: 'The drag preview is offset by ~2px on 2× DPI displays. Root cause: DPI-unaware getBoundingClientRect usage in the drag start handler.' },
      ],
      done: [
        { title: 'Dark / light theme toggle', type: 'feature', description: 'Apple-inspired dual-theme system with system preference detection and smooth transitions.' },
        { title: 'Multi-tab terminal panel', type: 'feature', description: 'Support multiple PTY sessions side by side, each with an independent WebSocket connection.' },
        { title: 'Tailwind CSS v4 migration', type: 'tech-debt', description: 'Migrated from v3 config-based setup to CSS-first @theme tokens. Eliminated tailwind.config.js entirely.' },
      ],
    },
  },
  {
    name: 'Backend API',
    tasks: {
      todo: [
        { title: 'Rate limiting on POST /spaces and POST /tasks', type: 'feature', description: 'Add per-IP rate limiting (100 req/min) on write endpoints to prevent runaway agent loops from flooding the board.' },
        { title: 'Paginated activity feed cursor in MCP tool', type: 'feature', description: 'kanban_list_activity currently returns the first page only. Expose the nextCursor in the tool response.' },
      ],
      'in-progress': [
        { title: 'Atomic writes for spaces.json', type: 'tech-debt', description: 'Replace direct fs.writeFileSync with write-to-temp + rename pattern to prevent data corruption on crash.', assigned: 'developer-agent' },
        { title: 'BUG: assigned field persists empty string', type: 'bug', description: 'PATCH /tasks/:id with assigned:"" stores the empty string instead of deleting the field. Reproduce: update task with empty assigned via MCP kanban_update_task.' },
      ],
      done: [
        { title: 'Modularize server.js into src/handlers/', type: 'tech-debt', description: 'Split 2636-line monolith into 10 focused modules. server.js reduced to 411 lines of wiring.' },
        { title: 'Pipeline field per task', type: 'feature', description: 'Tasks can override the space pipeline with a custom stage sequence. Resolution chain: task > space > default.' },
        { title: 'Pipeline templates CRUD', type: 'feature', description: 'Named pipeline templates with stages, checkpoints, and orchestrator mode. Persisted to data/pipeline-templates.json.' },
      ],
    },
  },
  {
    name: 'DevOps',
    tasks: {
      todo: [
        { title: 'GitHub Actions CI: lint + test on PR', type: 'chore', description: 'Add .github/workflows/ci.yml that runs npm test and cd frontend && npm test on every pull request.' },
        { title: 'Publish Docker image to GHCR on release tag', type: 'chore', description: 'On push to v*.*.* tags, build and push ghcr.io/oscarmenendezgarcia/prism:VERSION to GitHub Container Registry.' },
      ],
      'in-progress': [
        { title: 'Docker Compose health check', type: 'chore', description: 'Add healthcheck: test: curl -f http://localhost:3000/api/v1/spaces to docker-compose.yml so dependent services wait for readiness.', assigned: 'developer-agent' },
      ],
      done: [
        { title: 'Dockerfile multi-stage build', type: 'chore', description: 'Builder stage compiles node-pty native bindings. Runtime stage is minimal — no build tools, no source maps.' },
        { title: 'Add .dockerignore', type: 'chore', description: 'Exclude node_modules, dist, data, .env, agent-docs, and tests from the Docker build context.' },
      ],
    },
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nSeeding demo data → ${API}\n`);

  // Check connectivity
  const check = await fetch(`${API}/spaces`).catch(() => null);
  if (!check?.ok) {
    console.error(`✗ Cannot reach ${API}. Is the server running?`);
    process.exit(1);
  }

  for (const spaceData of SPACES) {
    console.log(`\n[${spaceData.name}]`);
    const space = await createSpace(spaceData.name);

    for (const [column, tasks] of Object.entries(spaceData.tasks)) {
      for (const taskDef of tasks) {
        const task = await createTask(space.id, taskDef);
        if (column !== 'todo') {
          await moveTask(space.id, task.id, column);
        }
        const col = column === 'todo' ? 'todo      ' : column === 'in-progress' ? 'in-progress' : 'done      ';
        console.log(`  [${col}] ${task.title}`);
      }
    }
  }

  console.log(`\n✓ Done. Open ${BASE_URL} to see the demo board.\n`);
}

main().catch((err) => {
  console.error('\n✗', err.message);
  process.exit(1);
});
