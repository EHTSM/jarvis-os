#!/usr/bin/env bash
# archive-plan.sh — moves dead files to _archive/<timestamp>/
# NEVER deletes. Preserves folder structure. Dry-run by default.
# Usage:
#   bash archive-plan.sh           # dry-run (shows what would move)
#   bash archive-plan.sh --execute # actually moves files
#   bash archive-plan.sh --execute 2>&1 | tee archive-run.log

set -euo pipefail

DRY_RUN=true
if [[ "${1:-}" == "--execute" ]]; then
  DRY_RUN=false
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ARCHIVE_ROOT="_archive/$TIMESTAMP"
MOVE_COUNT=0

log() { echo "[archive] $*"; }
drylog() { echo "[DRY-RUN] would move: $1 → $2"; }

move() {
  local src="$1"
  local dest_dir="$ARCHIVE_ROOT/$2"
  if [[ ! -e "$src" ]]; then
    log "SKIP (not found): $src"
    return
  fi
  if $DRY_RUN; then
    drylog "$src" "$dest_dir/"
  else
    mkdir -p "$dest_dir"
    git mv "$src" "$dest_dir/" 2>/dev/null || mv "$src" "$dest_dir/"
    log "MOVED: $src → $dest_dir/"
  fi
  MOVE_COUNT=$((MOVE_COUNT + 1))
}

move_dir() {
  local src="$1"
  local dest_subpath="$2"
  if [[ ! -d "$src" ]]; then
    log "SKIP (dir not found): $src"
    return
  fi
  local dest_dir="$ARCHIVE_ROOT/$dest_subpath"
  if $DRY_RUN; then
    count=$(find "$src" -type f | wc -l | tr -d ' ')
    drylog "$src/ ($count files)" "$dest_dir/"
  else
    mkdir -p "$(dirname "$dest_dir")"
    git mv "$src" "$dest_dir" 2>/dev/null || mv "$src" "$dest_dir"
    log "MOVED DIR: $src → $dest_dir"
  fi
  MOVE_COUNT=$((MOVE_COUNT + 1))
}

echo "=================================="
echo " JARVIS-OS Archive Plan"
echo " Timestamp : $TIMESTAMP"
echo " Mode      : $(if $DRY_RUN; then echo DRY-RUN; else echo EXECUTE; fi)"
echo " Target    : $ARCHIVE_ROOT/"
echo "=================================="
echo ""

# ── PHANTOM TESTS (09-83) ──────────────────────────────────────────
echo "--- Phantom Tests (09-83) ---"
for f in tests/runtime/09-recovery.test.cjs tests/runtime/10-benchmark.test.cjs; do
  move "$f" "tests/runtime"
done
for f in tests/runtime/1[3-9]-*.test.cjs \
          tests/runtime/[2-7][0-9]-*.test.cjs \
          tests/runtime/8[0-3]-*.test.cjs; do
  for matched in $f; do
    [[ -e "$matched" ]] && move "$matched" "tests/runtime"
  done
done

# ── DEAD AGENT DIRECTORIES ────────────────────────────────────────
echo ""
echo "--- Dead Agent Directories ---"
for d in agents/businessPro agents/enterprise agents/education agents/health \
          agents/life agents/humanAI agents/social agents/intelligence \
          agents/legal agents/security agents/governance agents/internet \
          agents/media agents/multi agents/interaction agents/knowledge \
          agents/rag agents/metrics agents/money agents/content \
          agents/business agents/core agents/dev agents/system agents/tools; do
  move_dir "$d" "agents"
done

# ── DEAD ROOT-LEVEL AGENT FILES ───────────────────────────────────
echo ""
echo "--- Dead Root-Level Agent Files ---"
for f in agents/crm.cjs agents/crmAgent.cjs agents/agentRouter.cjs \
          agents/fiverrLeads.cjs agents/googleMapsLeads.cjs agents/instagram.cjs \
          agents/leads.cjs agents/linkedinLeads.cjs agents/marketingAgent.cjs \
          agents/paymentAgent.cjs agents/realLeadsEngine.cjs agents/saas.cjs \
          agents/tool.cjs agents/trigger.cjs agents/primitives.cjs \
          agents/researchAgent.cjs; do
  move "$f" "agents"
done

# ── DEAD MODULE DIRECTORIES ───────────────────────────────────────
echo ""
echo "--- Dead Module Directories ---"
for d in modules/metaverse modules/futureTech modules/infrastructure; do
  move_dir "$d" "modules"
done

# ── DUPLICATE UI CODEBASES ────────────────────────────────────────
echo ""
echo "--- Duplicate UI Codebases ---"
move_dir "jarvis-ui/runtime-console" "ui"
move_dir "electron/jarvis-core" "ui"

# ── DEAD ROOT-LEVEL ORPHAN FILES ─────────────────────────────────
echo ""
echo "--- Dead Root-Level Orphan Files ---"
for f in orchestrator.cjs scheduler.cjs commandParser.cjs persistent_session.js \
          monitor_phase_p.sh "start-jarvis copy.sh" TEST_PLAIN_MARKDOWN.md \
          validate_calmness.js queue.json runtime_validation_overrides.json; do
  move "$f" "root"
done

# ── STALE ROOT-LEVEL MARKDOWN DOCS ───────────────────────────────
echo ""
echo "--- Stale Root-Level Docs ---"
for f in AI_ASSISTANT_GUIDE.md BACKUP_RESTORE_VALIDATION.md CLEANUP_PLAN.md \
          CONTROLLED_PUBLIC_MVP_READINESS.md CURRENT_RUNTIME_ARCHITECTURE.md \
          DAILY_DRIVER_ASSESSMENT.md DASHBOARD_INFORMATION_ARCHITECTURE.md \
          DEPRECATED_FILES.md FINAL_ARCHITECTURE.md FRONTEND_DEPLOYMENT_AUDIT.md \
          GOVERNANCE_ALIGNMENT_AUDIT.md LOGGING_DISCIPLINE.md \
          LONG_SESSION_VALIDATION.md MARKDOWN_SERIALIZATION_AUDIT.md \
          MOBILE_OPERATOR_EXPERIENCE.md NGINX_STATIC_SERVING_AUDIT.md \
          OPERATIONAL_OBSERVATIONS.md OPERATOR_FRICTION_LOG.md \
          PRODUCT_EXPERIENCE_CONSOLIDATION.md PRODUCTION_DISCIPLINE_REPORT.md \
          PRODUCTION_READINESS_ASSESSMENT.md PROJECT_STATUS.md \
          RUNTIME_BOUNDARIES.md RUNTIME_DEPENDENCY_MAP.md \
          STATE_TRANSITION_RELIABILITY.md TELEMETRY_OBSERVABILITY_REVIEW.md \
          UX_CONSISTENCY_REVIEW.md VALIDATION_BOUNDARY_AUDIT.md \
          VISUAL_SYSTEM_REVIEW.md VPS_FRONTEND_STATUS.md; do
  move "$f" "docs"
done

# ── DUPLICATE docs/current FILES ─────────────────────────────────
echo ""
echo "--- Duplicate docs/current Files ---"
for f in docs/current/DEPLOYMENT_ARCHITECTURE.md docs/current/DEPLOYMENT_GUIDE.md \
          docs/current/DEPLOYMENT.md \
          docs/current/MINIMAL_RUNTIME_ARCHITECTURE.md docs/current/CORE_RUNTIME.md \
          docs/current/PRODUCTION_ARCHITECTURE.md; do
  move "$f" "docs/current"
done

# ── DEAD EXPERIMENTAL DIRECTORIES ────────────────────────────────
echo ""
echo "--- Dead Experimental Directories ---"
move_dir "experimental/autonomous-research" "experimental"
move_dir "experimental/evolution-runtime" "experimental"
move_dir "experimental/legacy-agents" "experimental"
move_dir "automation" "root"
move_dir "workflows" "root"

echo ""
echo "=================================="
echo " Total items processed: $MOVE_COUNT"
if $DRY_RUN; then
  echo " DRY-RUN complete. Run with --execute to apply."
else
  echo " Archive complete: $ARCHIVE_ROOT/"
fi
echo "=================================="
