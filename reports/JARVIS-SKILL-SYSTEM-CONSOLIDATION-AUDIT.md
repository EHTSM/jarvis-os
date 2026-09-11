# JARVIS Skill System Consolidation & External Skill Catalog Audit

**Mission 29** — 2026-08-22
**Branch:** security/reality-completion (no commits made)

## Bottom line

JARVIS-OS has **no Claude-Code-style Agent Skills system** today — no `SKILL.md`, no `skills/`
directory, no trigger/routing engine. The NVIDIA `nvidia/skills` catalog (343 skills, verified live)
is a product-support catalog for NVIDIA's own GPU/robotics/vision/training-infrastructure stack
(DOCA, DeepStream, Jetson, TAO, Holoscan, Megatron-Bridge, Earth2Studio, Omniverse, physical-AI/
Isaac-style workflows). After auditing all 343 entries against JARVIS's actual architecture, **zero
skills were installed**. JARVIS's only NVIDIA touchpoint is `NVIDIA_API_KEY` / NVIDIA NIM used as one
of 14 interchangeable LLM chat-completion providers in `aiService.js` — no GPU workload, no RAG
pipeline, no vector store, no training/inference infra that any catalog skill addresses. Installing
from this catalog would add dead weight, not capability. No architecture was built (none was needed),
no files were modified, no packages were installed, `.env` untouched, nothing committed or pushed.

---

## TASK A — Inventory of existing skill infrastructure

Full-repo search (excluding `node_modules`) for `SKILL.md`, `skills/` directories, skill loaders,
registries, and routing/trigger logic.

| Item | Found? | Detail |
|---|---|---|
| `SKILL.md` files | No | Zero matches anywhere in the repo |
| `skills/` or `skill/` directories | No | Zero matches anywhere in the repo |
| `.claude/skills/` | No | `.claude/` contains only `settings.json`, `settings.local.json`, empty `worktrees/` |
| Skill loader/trigger/routing engine (Claude-Code-style) | No | No `SkillLoader`, `loadSkill`, `skillTrigger`, `AgentSkill`, `skill.json` identifiers anywhere |
| `package.json` skills-CLI references | No | No `skills.sh`, `@anthropic/skills`, `npx skills`, `nvidia/skills` mentions in any `package.json` |

JARVIS does use the word "skill" internally, but for an unrelated concept — a virtual-company
capability-simulation vocabulary, not a Claude-Code Agent Skills mechanism:

| Name | Source | Purpose | Trigger | Dependency | Duplicate risk | JARVIS relevance |
|---|---|---|---|---|---|---|
| `skillRegistry.cjs` (320 lines) | `backend/services/` | Metadata/discovery layer over existing capability handlers ("Universal Composition Engine, Phase 5"). Stores `{id, name, category, riskLevel, executionHandler, version, healthStatus}` records, seeded from `data/skills.json`. Does **not** execute anything itself — `executionHandler` resolves to real handlers in `agentRegistry.cjs`/`engineeringCapabilities.cjs`. | Called by composition/blueprint APIs | `capabilityContract.cjs` schema | None — no naming collision with Claude Code Agent Skills (no `SKILL.md`, no filesystem skill packages) | Internal only, not a skill-loading mechanism |
| `skillEngine.cjs` (274 lines) | `backend/services/` | Hardcoded `AGENT_CATALOGUE` (27 static entries) + `SKILL_INDEX` tag lookup for workforce-capacity simulation | Consumed by `teamBuilder.cjs`, `workforceDashboard.cjs`, `performanceEngine.cjs`, `capacityPlanner.cjs` | None | None | Confirmed dead/simulation-only, no execution path |
| `capabilityContract.cjs` (358 lines) | `backend/services/` | JSON-shape validator for a `Company→Department→Agent→Skill→Tool→Connector→...` blueprint graph; defines the `Skill` kind schema | Used by blueprint validation | None | None | Schema validator, not a runtime |
| `agentRegistry.cjs` (167 lines) | `agents/runtime/` | The **actual real task dispatcher** — per-agent circuit breakers, populated via `runtimeOrchestrator.cjs`'s `registerAgent()`, wired to `taskRouter.cjs` → `executionEngine.executeTask()` with retry/timeout/dead-letter queue | Live dispatch, 8 registered capabilities in practice | — | None | This is JARVIS's real capability-routing system; unrelated to "skills" naming but functionally closest to what an Agent Skills router would need to plug into |
| `adapterCapabilityRegistry.cjs` | `agents/runtime/` | Older, separate capability-tag registry, not folded into the newer `skillRegistry`/composition consolidation | — | — | None | Legacy, documented in `docs/audits/UNIVERSAL-COMPOSITION-ENGINE-REALITY.md` |

**Conclusion for Task A:** No naming or architectural collision exists between JARVIS's internal
"skill" vocabulary and a genuine Claude-Code-style Agent Skills system. If one is ever built, avoid
the bare identifiers `skillRegistry`/`SkillLoader` to prevent audit confusion with the existing
`backend/services/skillRegistry.cjs`, but no rename or removal is required.

---

## TASK B — NVIDIA catalog discovery

Catalog fetched live via `npx skills add nvidia/skills --list` (read-only dry-run, no install) from
`https://github.com/nvidia/skills.git`. **343 skills discovered** — the full current catalog, not a
cached/stale list.

Category breakdown of the 343 (by name-prefix family):

| Family | Count (approx.) | Domain |
|---|---|---|
| `doca-*` | 58 | BlueField DPU/ConnectX NIC networking |
| `tao-*` | 40 | Vision model training (TAO Toolkit) |
| `i4h-*` / `physical-ai-*` | 20 | Robotics / physical-AI simulation |
| `jetson-*` | 26 | Jetson embedded-device flashing/tuning |
| `nemo-mbridge-perf-*` | 15 | Megatron-Bridge distributed-training performance tuning |
| `vss-*` / `rtvi-*` | 18 | Video Search & Summarization / video analytics microservices |
| `deepstream-*` / `amc-*` | 12 | Video-analytics GStreamer pipelines / camera calibration |
| `holohub-*` / `holoscan-*` / `hsb-*` | 15 | Holoscan sensor-bridge medical-device SDK |
| `earth2studio-*` | 6 | Weather/climate forecasting |
| `dicom-*` / `digital-health-*` / `nv-generate-*` / `nv-segment-*` | 13 | Medical imaging |
| `cuopt-*` / `cupynumeric-*` / `warp-*` / `tilegym-*` | 20 | CUDA numerical/optimization libraries |
| `nemo-relay-*` / `nemo-rl-*` / `nemo-automodel-*` / `nemo-fabric-*` | 22 | NeMo model training/instrumentation stack |
| `rag-*` | 3 | NVIDIA RAG Blueprint (a specific packaged product, not generic RAG) |
| `dynamo-*` | 4 | Disaggregated LLM-serving deployment (Kubernetes-based) |
| `omniverse-*` / `mcore-*` / others | ~30 | Omniverse 3D, Megatron-LM core, misc |

None of the 343 skill names or descriptions match generic categories the mission prioritized
(software engineering, general debugging, general testing frameworks, general DevOps/CI, general
security review, general agent-development frameworks, general documentation, general automation).
This catalog is NVIDIA's own product-support surface, not a general engineering skill library.

**JARVIS-relevant candidates surfaced after filtering** (closest matches only, all still weak):

- `rag-blueprint`, `rag-eval`, `rag-perf` — tied to NVIDIA's packaged RAG Blueprint product/API surface
- `nemo-relay-*` (10 skills) — LLM/tool-call instrumentation & observability, tied to the NeMo Relay library
- `data-designer` — synthetic dataset generation via NVIDIA's Data Designer product
- `nvidia-skill-finder`, `skill-card-generator` — meta-tools for navigating NVIDIA's own skill catalog

---

## TASK C — Duplicate / overlap analysis & classification

Verified against JARVIS's actual stack: `package.json` dependencies (`groq-sdk`, `openai`, `axios`,
`express`, `better-sqlite3`, no NVIDIA SDK, no vector-store client, no Kubernetes/Triton/Dynamo
client) and a grep across `backend/services/` for `nvidia|nemo|triton|nim|rag|vector-store|embedding`.

**Confirmed:** NVIDIA usage in JARVIS is a single `NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions"`
entry in `aiService.js`, alongside 13 other providers (groq, openrouter, openai, claude, gemini,
ollama, deepseek, together, fireworks, cohere, lmstudio, grok, qwen) — a plain chat-completion API
call, no GPU workload, no deployed NVIDIA infrastructure. No vector store or RAG pipeline exists
anywhere in the codebase.

| Candidate | Classification | Reason |
|---|---|---|
| `rag-blueprint` | DO NOT INSTALL — irrelevant | Targets NVIDIA's packaged RAG Blueprint deployment (its own Docker/K8s stack), not a generic RAG library JARVIS could call. JARVIS has no RAG pipeline to attach it to. |
| `rag-eval` | DO NOT INSTALL — irrelevant | Same product dependency; also assumes a `corpus/`+`train.json` RAGAS setup JARVIS doesn't have. |
| `rag-perf` | DO NOT INSTALL — irrelevant | Benchmarks a *deployed* NVIDIA RAG Blueprint server; nothing to benchmark. |
| `nemo-relay-instrument-calls` / `-observability` / etc. (10 skills) | DO NOT INSTALL — irrelevant | Wraps tool/LLM call sites with the NeMo Relay library specifically. JARVIS already has its own multi-provider `aiService.js`/`aiOrchestrator.cjs`/`usageMetering.cjs` for call routing, retries, and metering — adding a second, NVIDIA-specific instrumentation layer would be a duplicate control path, not a complement. |
| `data-designer` | DO NOT INSTALL — irrelevant | Synthetic-data generation tied to NVIDIA's Data Designer product/API; JARVIS has no use case requiring it today. |
| `dynamo-*` (4 skills) | DO NOT INSTALL — irrelevant | Kubernetes-based disaggregated LLM-serving deployment; JARVIS calls hosted provider APIs, does not self-host inference servers. |
| `nvidia-skill-finder`, `skill-card-generator` | DO NOT INSTALL — irrelevant | Meta-tools for authoring/discovering skills *within NVIDIA's own catalog repo*; not applicable to consuming skills in JARVIS. |
| All `doca-*` (58), `tao-*` (40), `jetson-*` (26), `deepstream-*`/`amc-*` (12), `vss-*`/`rtvi-*` (18), `holohub-*`/`holoscan-*`/`hsb-*` (15), `i4h-*`/`physical-ai-*` (20), `earth2studio-*` (6), `dicom-*`/`digital-health-*`/`nv-generate-*`/`nv-segment-*` (13), `cuopt-*`/`cupynumeric-*`/`warp-*`/`tilegym-*` (20), `nemo-mbridge-*`/`nemo-rl-*`/`nemo-automodel-*`/`nemo-fabric-*`/`mcore-*` (~40), `omniverse-*` (3), `cudaq-guide`, `portfolio-optimization`, `paidf-anomalygen`, `physicsnemo-*` | DO NOT INSTALL — irrelevant | Explicitly out of scope per mission instructions (physical-AI, robotics, autonomous-driving, Omniverse, CUDA-specific, hardware-networking) or address domains (medical imaging, weather forecasting, embedded-device flashing, GPU kernel authoring) with no corresponding JARVIS subsystem. |

**No candidate was classified INSTALL, ADAPT, or INVESTIGATE.** Every one of the 343 either falls
into an explicitly excluded domain or targets a specific NVIDIA product/deployment JARVIS does not
run. No duplicate-capability conflicts exist because nothing overlapping was found to install.

---

## TASK D — Skill architecture assessment

**Question:** Can JARVIS's existing runtime safely load local skills, external skills, skill
metadata, triggers, routing, precedence, versioning, isolation?

**Answer:** No dedicated skill-loading architecture exists (Task A confirms this), and **none needs
to be built in this mission** — there is nothing classified INSTALL to load. Per mission instruction
("do NOT implement a new architecture in this mission unless absolutely necessary and proven by the
existing code"), building a skill-loading engine with zero approved skills to load would be
speculative infrastructure, which is explicitly against JARVIS's engineering conventions.

**If a future mission needs to install genuinely relevant skills**, the smallest integration point
already exists and should be reused rather than rebuilt:

- `agentRegistry.cjs` (`agents/runtime/`) is JARVIS's real, live capability dispatcher — per-capability
  registration, circuit breakers, retry/timeout, dead-letter queue, routed through `taskRouter.cjs`.
  A skill (in the Claude-Code sense: a packaged instruction set with trigger metadata) would map
  naturally onto a new capability entry here rather than a parallel system.
- `capabilityContract.cjs`'s existing `Skill` kind schema (`id, name, category, riskLevel,
  executionHandler, version`) already has the right shape for skill metadata + versioning if the
  "skill" is meant to be an *executable capability*. It does not currently support markdown-based
  instruction-injection skills (SKILL.md + frontmatter + trigger-matching against a model's context),
  which is a fundamentally different mechanism — that would need its own lightweight loader
  (read `SKILL.md` frontmatter, match description against a query, inject content) rather than
  reuse of `capabilityContract.cjs`.
- No isolation/sandboxing exists for either concept today; per Task F, this matters once real
  external skill code is installed and would need to be scoped then, not speculatively now.

**Recommendation:** Do not build skill infrastructure until a specific INSTALL-classified skill
exists that needs it. This mission found none.

---

## TASK E — Installation

**Zero skills installed.** No candidate reached the INSTALL classification (Task C). Per mission
instruction, targeted installs only would have been used (`npx skills add nvidia/skills --skill
<name>`) had any candidate qualified — none did. The catalog `--list` dry-run used for discovery
did not install anything: verified `~/.claude/skills/` (global scope) contains only a pre-existing
`skill-creator` entry from 2026-05-17, predating this mission, and `.claude/skills/` does not exist
at the project level.

---

## TASK F — Security

Not applicable — no skills were installed, so no external skill code was loaded into any trust
boundary. No arbitrary shell execution, credential access, filesystem access, network access,
prompt-injection instructions, destructive commands, hidden dependencies, or environment
modification was introduced, because nothing was added.

One process-level note for the record: browsing the catalog via `npx skills add nvidia/skills --list`
shallow-clones `https://github.com/nvidia/skills.git` to a temporary directory to enumerate its
343 `SKILL.md` files, then discards the clone — this is read-only discovery, not an install, and
left no artifacts in the repo or in global skill directories.

---

## TASK G — Validation

No skills were installed, so load/trigger/routing/failure/isolation/duplicate-conflict tests and
the negative disable-then-restore test do not apply — there is nothing to test.

**Regression baseline (before/after, unchanged since nothing was modified):**

- `node --test tests/runtime/04-agentRegistry.test.cjs` → **16/16 pass**, 0 fail (agent-registry
  dispatcher, the system Task D identifies as the reuse point for any future skill work)
- No frontend/backend/build/security-suite runs were required beyond this — no code path was
  touched by this mission (inventory + external catalog research only).

---

## TASK H — JARVIS skill registry

No existing registry matches the Claude-Code Agent Skills concept (Task A), and no approved skill
exists to register (Task C/E). Per mission instruction ("If missing, ONLY document the required
registry design; do not create unnecessary architecture"), the design is documented in Task D above
and no registry was created.

---

## Final report summary

| Item | Result |
|---|---|
| Existing skills count (Claude-Code Agent Skills sense) | 0 |
| Existing internal "skill" constructs (unrelated concept) | 4 files (`skillRegistry.cjs`, `skillEngine.cjs`, `capabilityContract.cjs`, `agentRegistry.cjs`) — inventoried, no conflict |
| NVIDIA candidates discovered | 343 (full live catalog) |
| Skills installed | 0 |
| Skills rejected and why | 343/343 — all fall into mission-excluded domains (physical-AI, robotics, DOCA networking, CUDA/vision/medical-imaging training infra) or target specific NVIDIA products/deployments (RAG Blueprint, NeMo Relay, Dynamo, Data Designer) with no corresponding JARVIS subsystem; JARVIS's only NVIDIA touchpoint is NIM as one of 14 interchangeable chat-completion API providers |
| Duplicate capabilities found | None — no candidate reached INSTALL, so no overlap analysis against live JARVIS capability was needed beyond the stack-verification in Task C |
| Security findings | None — no external code loaded |
| Architecture findings | No skill-loading architecture exists; none built (nothing to load); reuse point identified (`agentRegistry.cjs` + `capabilityContract.cjs`'s `Skill` schema) for a future mission if a genuine candidate emerges |
| Tests before/after | `tests/runtime/04-agentRegistry.test.cjs`: 16/16 pass, unchanged (no code modified) |
| Build | Not run — no frontend/build code touched |
| Security suite | Not run — no security-relevant code touched |
| `.env` status | Untouched |
| Server status | Not restarted — no runtime change made |
| Merge/push status | None — no commits made, per mission instruction |
