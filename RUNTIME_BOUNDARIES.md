# Runtime Boundaries

> [!NOTE]
> To prevent "spaghetti architecture," Jarvis enforces strict boundaries between its layers.

## The CORE Boundary
The Core is the absolutely minimal set of files required to boot the server, authenticate an operator, and accept a task. 

**Allowed in Core:**
- `server.js` (Express, Routing, Auth Middleware)
- `runtimeOrchestrator.cjs` (The main event loop)
- `taskQueue.cjs` (The priority buffer)
- `governor.cjs` (System limits and E-STOP)
- `sseStream.cjs` (Frontend telemetry broadcast)
- `executor.cjs` (The routing logic)

**Forbidden in Core:**
- LLM API calls (These belong in services/plugins).
- Vector DB integrations.
- Native desktop automation (e.g., `robotjs`).

## The PLUGINS Boundary
Plugins are discrete, isolated folders inside `/plugins/`.
- A plugin exports a strict `execute()` interface.
- A plugin cannot start its own HTTP server.
- A plugin cannot manipulate the `taskQueue` directly. It must return a result to the `executor`, which handles the orchestration.
- If a plugin crashes, it must be caught by `executor.cjs` and the error bubbled up to the operator. It must not crash `server.js`.

## The EXPERIMENTAL Boundary
Files in `/experimental/` are considered completely external to Jarvis.
- No file in `/agents/` or `/backend/` or `server.js` may `require()` or `import` any file from `/experimental/`.
- Experimental files are treated as text archives. If an experimental system needs to be tested, it must be copied into a separate testing environment or explicitly ported into a compliant Plugin.
