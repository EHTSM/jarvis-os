# Current Runtime Architecture

> [!IMPORTANT]
> This is the single source of truth for the active Jarvis OS production runtime. Any document that contradicts this file (e.g., mentioning 500-agent orchestrations or autonomous self-improving swarms) is legacy and should be ignored.

## The Production Runtime (What Actually Runs)

Jarvis is currently a strict, synchronous task-execution platform designed for reliability and operator control. It is **not** an AGI system. 

### Core Components
1. **Frontend (`/frontend`)**: A React-based Operator Control Center. Communicates with the backend exclusively via REST (`/api`) and Server-Sent Events (`/api/runtime/stream`). It contains no business logic.
2. **Backend Server (`server.js`)**: An Express server handling Auth, API routes, and SSE streaming.
3. **Runtime Orchestrator (`runtimeOrchestrator.cjs`)**: The core loop. It initializes the `Dispatcher`, `Governor`, `MemoryContext` (stubbed), and the `Executor`.
4. **Task Queue (`taskQueue.cjs`)**: A priority queue (levels 0, 1, 2) that manages execution backpressure.
5. **Executor (`executor.cjs`)**: The single router that receives a task, maps it to a capability/service, and executes it. 

### Active Execution Flow
1. Operator submits a task via the `WorkflowPanel` (Frontend).
2. The task hits `/api/tasks/dispatch` or `/api/tasks/queue` on `server.js`.
3. The `Dispatcher` formats the task and pushes it into `taskQueue.cjs`.
4. The `RuntimeOrchestrator` pops the task and passes it to `executor.cjs`.
5. `executor.cjs` strictly routes the task to a verified plugin or service (e.g., `executeBrowserTask`, `executeCrmTask`). 
   - *Note: Autonomous execution routing is permanently disabled.*
6. The result is passed back to the `RuntimeOrchestrator`.
7. The `sseStream.cjs` module broadcasts the `execution` result back to the frontend.

### The Governor & Safe-Exec
The `Governor` runs continuously. If memory usage spikes above critical thresholds, or if the Operator triggers the Emergency Stop, the Governor physically halts the `RuntimeOrchestrator` event loop. No tasks are popped from the queue until the Governor releases the lock.

## The Plugin Model
Jarvis supports optional plugins (e.g., Local Desktop, Voice Control) located in `/plugins/`. 
- Plugins **cannot** self-bootstrap. 
- They are manually loaded and explicitly executed via strict capability mapping in `executor.cjs`.

## Deprecated Architecture (Do Not Use)
- `agents/master/`, `agents/evolution/`, `agents/learning/` (Moved to `/experimental/`)
- Dynamic agent generation (`AgentFactory`)
- ContextEngine vector databases (Replaced with in-memory stubs)
- `robotjs` desktop automation (Moved to plugin, removed from core)
