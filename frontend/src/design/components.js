/**
 * Ooplix Design System — Component Hierarchy
 * Figma-ready component map. Defines the prop API surface and token
 * references for every reusable component in the system.
 *
 * This file is a reference spec — not executable code.
 * Each entry defines: component name, atoms it uses, variants, and
 * the CSS classes or token vars that govern its appearance.
 */

/**
 * LAYER 1 — PRIMITIVES (token values, not rendered)
 * ─────────────────────────────────────────────────
 * Token/Color      — index.css :root color vars
 * Token/Typography — index.css type vars
 * Token/Spacing    — index.css space vars
 * Token/Motion     — index.css duration + easing vars
 * Token/Elevation  — index.css shadow + surface vars
 * Token/Execution  — index.css exec-* state vars
 */

/**
 * LAYER 2 — ATOMS (single-purpose, no children)
 * ──────────────────────────────────────────────
 *
 * StatusDot
 *   States:    idle | queued | running | thinking | done | error | paused
 *              online | offline
 *   Sizes:     default (7px) | lg (10px)
 *   CSS:       .status-dot .status-dot--{state} .status-dot--lg
 *   Animation: running → pulse-dot loop; thinking → pulse-dot loop; offline → pulse-offline
 *
 * Badge
 *   Variants:  accent | teal | success | warning | danger | info | dim
 *              running | thinking | done | error | queued | paused   (exec states)
 *              critical | high | normal                               (priority)
 *   Modifiers: pill
 *   CSS:       .badge .badge--{variant} .badge--pill
 *
 * Icon
 *   Grid:      16×16 (nav) | 20×20 (standard) | 24×24 (large)
 *   Stroke:    2px, round caps, round joins
 *   Set:       terminal, brain, code, workflow, shield,
 *              check, x, pause, play, arrow-right, chevron, search,
 *              agent, deploy, alert, clock, refresh
 *
 * Timestamp
 *   Font:      --font-mono, --type-mono-sm
 *   Color:     --text-faint
 *   Format:    relative ("2m ago") or absolute ("14:32:01")
 *
 * Metric
 *   Value:     --type-display weight 700
 *   Label:     --type-nano uppercase --text-faint
 *   Diff:      --type-caption --success/--danger + arrow icon
 *   Animation: counter-pop on value change
 *
 * Tag
 *   Size:      12px pill, --surface-raised bg, --border border
 *   Use:       zone attribution on search results
 */

/**
 * LAYER 3 — MOLECULES (composed from atoms)
 * ──────────────────────────────────────────
 *
 * AgentCard
 *   ├── StatusDot (top-right, animated if running)
 *   ├── Agent name (--type-body-m, weight 600)
 *   ├── Agent ID (--font-mono, --type-mono-sm, --text-faint)
 *   ├── Current task description (--type-body, --text-dim)
 *   ├── Progress bar (optional, --accent fill)
 *   ├── Last action (--type-caption, --text-faint)
 *   └── Actions: [Pause] [Stop] [Log →]
 *   States:    exec-state--{state} applied to card border + bg
 *   CSS:       .agent-card .agent-card--{state}
 *
 * ExecutionRow
 *   ├── StatusDot (7px)
 *   ├── Timestamp (mono-sm, --text-faint)
 *   ├── Badge (exec state)
 *   ├── Agent ID (mono-sm, dim)
 *   ├── Description (body, truncate)
 *   └── Outcome badge (optional)
 *   Height:    48px
 *   Hover:     --surface-hover bg
 *   State bg:  exec-state--{state}
 *   CSS:       .exec-row .exec-row--{state}
 *
 * MetricCard
 *   ├── Label (section-label)
 *   ├── Value (Metric atom)
 *   ├── Sparkline (optional, 36px tall SVG)
 *   └── Diff row (optional)
 *   CSS:       .metric-card
 *
 * ApprovalCard
 *   ├── Priority Badge (critical | high | normal)
 *   ├── Action description (--type-body-m)
 *   ├── Risk score bar (5-step fill, --danger → --success)
 *   ├── Impact summary (--type-caption, --text-dim)
 *   ├── [Approve ✓] btn--success
 *   ├── [Reject ✗]  btn--danger
 *   └── [Review →]  btn--ghost
 *   Animation: pulse-border 3× on mount (attention signal)
 *   On Approve: green flash → AnimatePresence exit → row removed
 *   CSS:       .approval-card .approval-card--{priority}
 *
 * NotificationItem
 *   ├── Icon (semantic, 16px)
 *   ├── Message (body, truncate 2 lines)
 *   ├── Timestamp (caption, --text-faint)
 *   └── Action link (optional, --accent)
 *   CSS:       .notif-item .notif-item--{type}
 *
 * HealthPulseItem
 *   ├── StatusDot (online | warning | error)
 *   ├── Label (--type-nano uppercase)
 *   └── Value (--type-caption)
 *   CSS:       .health-item
 *
 * CommandInput
 *   ├── Prefix icon (slash / @ / lightning)
 *   ├── Text field (.input .input--mono)
 *   └── Submit key hint (kbd element)
 *   CSS:       .command-input
 */

/**
 * LAYER 4 — ORGANISMS (complex, self-contained UI regions)
 * ──────────────────────────────────────────────────────────
 *
 * HealthPulseBar
 *   Atoms:   HealthPulseItem ×N (status dots + labels)
 *   Height:  --health-bar-height (38px)
 *   Layout:  horizontal flex, gap 24px, px 32px
 *   Data:    online, agents count, api latency, error count, deploy status
 *   CSS:     .health-pulse-bar
 *
 * MissionFeed
 *   Atoms:   ExecutionRow ×N
 *   Scroll:  virtualized, newest at bottom
 *   Empty:   skeleton rows ×3
 *   Header:  "Mission Feed" section-label + live badge (dot--running)
 *   CSS:     .mission-feed .mission-feed-list
 *
 * ActiveAgentsGrid
 *   Atoms:   AgentCard ×N
 *   Layout:  auto-fill grid, min 240px per card
 *   Empty:   3 skeleton cards
 *   Header:  "Active Agents" section-label + count badge
 *   CSS:     .agents-grid
 *
 * ApprovalQueue
 *   Atoms:   ApprovalCard ×N
 *   Layout:  vertical stack, gap 8px
 *   Header:  "Approvals" + count badge (--warning if >0)
 *   Empty:   "No pending approvals" muted text + checkmark
 *   CSS:     .approval-queue
 *
 * NotificationsDrawer
 *   Atoms:   NotificationItem ×N
 *   Width:   --drawer-width (320px)
 *   Layout:  right-anchored panel, fixed position
 *   Header:  "Notifications" + [Mark all read]
 *   CSS:     .notif-drawer .notif-drawer--open
 *
 * ZoneNav
 *   Atoms:   OoplixLogo, ZoneNavItem ×5, ZoneNavAI, CmdPaletteTrigger, StatusDot
 *   Height:  --zone-nav-height (56px)
 *   CSS:     .zone-nav (defined in App.css)
 *
 * ZoneSubNav
 *   Atoms:   ZonePanelItem ×4
 *   Height:  --zone-subnav-height (44px)
 *   CSS:     .zone-subnav (defined in App.css)
 */

/**
 * LAYER 5 — PAGES / ZONE VIEWS
 * ─────────────────────────────
 *
 * CommandView (Zone 0)
 *   Layout: column stack
 *   ├── HealthPulseBar        (38px, always first)
 *   ├── MissionFeed           (flex: 1, scrollable)
 *   └── ActiveAgentsGrid      (below fold or right column)
 *   Right drawer: ApprovalQueue + NotificationsDrawer (persistent)
 *
 * IntelligenceView (Zone 1)
 *   ├── Memory graph (zone-specific content from MemoryOSV2)
 *   ├── Prediction cards (from PredictionPanel)
 *   └── Brain visualisation (from JarvisBrainCenter)
 *
 * EngineeringView (Zone 2)
 *   ├── Pipeline status (from DevOpsCenterV2)
 *   ├── Code search (from DeveloperCopilotV2)
 *   └── Guardrails score (from GuardrailsDashboard)
 *
 * WorkflowsView (Zone 3)
 *   ├── Automation builder (from WorkflowOSV2)
 *   ├── Revenue metrics (from AutonomousRevenueCenter)
 *   └── Agent factory (from AgentFactoryCenter)
 *
 * OperationsView (Zone 4)
 *   ├── Security posture (from TrustComplianceCenter)
 *   ├── Self-healing log (from SelfHealingCenter)
 *   └── Integration grid (from IntegrationCenter)
 *
 * Landing (public)
 *   Sections: Hero | OS Metaphor | Zone Tour | Execution Story
 *             Trust | Proof | Pricing Preview | Final CTA | Footer
 *
 * Auth screens: Login | Signup | ForgotPassword
 * Onboarding:   BusinessProfile → AccountCreation → App
 */

export default {};
