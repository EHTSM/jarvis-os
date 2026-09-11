#!/usr/bin/env node
"use strict";
/**
 * Docker production build correctness regression — Dockerfile.production.
 *
 * CONFIRMED findings (Jarvis Final Production Packaging Certification,
 * Phase 3), reproduced with real `docker build --no-cache` runs, not
 * inferred from reading the Dockerfile:
 *
 * 1. `COPY orchestrator.cjs ./` referenced a file that never existed at
 *    the repo root — every `docker build` failed on this exact line,
 *    before any native-module concern even mattered. Confirmed this
 *    predates the packaging certification pass entirely
 *    (`git show HEAD:Dockerfile.production` at session start already had
 *    it). Removed — backend/server.js is the real, sole entrypoint per
 *    ecosystem.config.cjs's own comment.
 *
 * 2. `npm ci --omit=dev --ignore-scripts` combined with a trailing
 *    `| grep -v "^npm warn" || true` masked a real, total install
 *    failure: --ignore-scripts skips better-sqlite3's install step
 *    entirely (confirmed empirically: a fresh --ignore-scripts install
 *    produces zero .node files, not a wrong-ABI one), and even with
 *    scripts enabled, node-pty and better-sqlite3 both need
 *    python3/make/g++ to compile from source on Alpine/musl (no prebuild
 *    published for that libc), and a third dependency,
 *    @authenio/xsd-schema-validator (real, used by ssoService.cjs's
 *    optional SAML XSD pre-validation), needs `javac` in its postinstall.
 *    None of that toolchain existed in the single-stage image. `npm ci`
 *    exited 127; `| grep ... || true` swallowed it; the Docker build step
 *    reported success anyway. Verified: the resulting image had ZERO
 *    packages in node_modules (`ls node_modules | wc -l` → 0) — the
 *    container would have crashed on require("express") on every boot.
 *
 * 3. No .dockerignore existed — every build sent ~1.78GB (node_modules,
 *    .git, data/, logs/) into the build context.
 *
 * Fix: added a native-builder stage carrying the full toolchain
 * (python3/make/g++/openjdk17-jdk), whose node_modules is COPY'd into the
 * slim runtime stage (verified final image: 198MB, no toolchain weight
 * leaked through). npm ci's real exit code is now captured before being
 * piped through grep (Alpine's /bin/sh is BusyBox ash — no $PIPESTATUS,
 * so output is redirected to a file first, then the real npm ci exit code
 * is checked directly). Removed the orchestrator.cjs COPY. Added
 * .dockerignore. Added utils/ and plugins/ to the COPY list (same gap
 * class as the Electron build.files fix in this same pass).
 *
 * This test statically verifies the Dockerfile source contains none of
 * the confirmed-broken patterns and does contain the fix markers — it
 * does NOT re-run `docker build` (that takes minutes and needs a Docker
 * daemon, done manually and verified end-to-end, including a real running
 * container with a real SQLite INSERT/SELECT, during this remediation
 * session) so this stays fast enough for routine CI.
 *
 * Usage: node tests/security/32-docker-build-correctness.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const fs = require("fs");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

const dockerfile = fs.readFileSync("Dockerfile.production", "utf8");

section("No reference to the nonexistent orchestrator.cjs");
{
  assert(!/COPY\s+orchestrator\.cjs/.test(dockerfile), "Dockerfile no longer COPYs orchestrator.cjs (it never existed at the repo root)", "found a COPY orchestrator.cjs line — build will fail on this exact line again");
  assert(!fs.existsSync("orchestrator.cjs"), "confirms orchestrator.cjs genuinely does not exist at the repo root (the Dockerfile fix is correct, not papering over a real missing file)", "orchestrator.cjs now exists — if it was intentionally added, the Dockerfile COPY should be restored");
}

section("npm ci failure cannot be silently masked");
{
  // The dangerous pattern specifically: `npm ci` piped DIRECTLY into grep,
  // which makes the RUN step's exit status grep's (always 0 if anything
  // survives the filter), not npm's — silently discarding a real install
  // failure. The fixed version still uses `grep ... || true` for the
  // post-hoc log-filtering step, but only AFTER npm ci's real exit code
  // was already captured to a file and checked separately — that `|| true`
  // is harmless (it only means "don't fail if grep finds nothing to
  // filter"), so this check must distinguish the two shapes, not just grep
  // for the substring "|| true" anywhere near npm ci.
  assert(!/npm ci[^;\n]*\|\s*grep/.test(dockerfile), "npm ci's output is not piped directly into grep (the pipe-loses-exit-code bug)", "found npm ci piped directly into grep — this discards npm's real exit code in favor of grep's");
  assert(/ec=\$\?/.test(dockerfile) || /if \[ "\$ec"/.test(dockerfile), "Dockerfile captures npm ci's real exit code before it can be lost to a pipe", "no exit-code capture pattern found");
}

section("Native module build toolchain is present for the stage that runs npm ci");
{
  assert(/python3/.test(dockerfile) && /make/.test(dockerfile) && /g\+\+/.test(dockerfile), "build stage installs python3/make/g++ (needed for better-sqlite3 and node-pty to compile on Alpine/musl, which has no prebuild for either)", "build toolchain packages not found");
  assert(/openjdk/.test(dockerfile), "build stage installs a JDK (needed for @authenio/xsd-schema-validator's javac postinstall)", "no openjdk package found");
  assert(!/RUN npm ci --omit=dev --ignore-scripts/.test(dockerfile), "the runtime stage's npm ci no longer uses --ignore-scripts (that flag alone produces zero native binaries for better-sqlite3)", "found --ignore-scripts still in use on an npm ci that's expected to produce native binaries");
}

section("Multi-stage build keeps toolchain weight out of the runtime image");
{
  const stageMatches = [...dockerfile.matchAll(/^FROM\s+\S+\s+AS\s+(\S+)/gm)].map(m => m[1]);
  assert(stageMatches.includes("native-builder"), "a dedicated native-builder stage exists", `stages found: ${JSON.stringify(stageMatches)}`);
  assert(stageMatches.includes("runtime"), "a dedicated runtime stage exists", `stages found: ${JSON.stringify(stageMatches)}`);
  assert(/COPY --from=native-builder .*node_modules/.test(dockerfile), "the runtime stage COPYs node_modules from native-builder rather than reinstalling with the toolchain present", "no cross-stage node_modules COPY found — toolchain may leak into the runtime image");
}

section("Backend's real cross-directory require() targets are all COPY'd");
{
  // Same dependency-graph fact this session's Electron packaging fix
  // relies on: agents/business/paymentAgent.cjs and marketingAgent.cjs
  // require top-level utils/, not backend/utils/.
  for (const dir of ["backend", "agents", "plugins", "utils"]) {
    assert(new RegExp(`COPY\\s+${dir}/`).test(dockerfile), `Dockerfile COPYs ${dir}/`, `no COPY ${dir}/ line found`);
  }
}

section(".dockerignore exists and excludes bulk/sensitive paths");
{
  assert(fs.existsSync(".dockerignore"), ".dockerignore exists", "no .dockerignore file found — every build sends the full working tree as context");
  if (fs.existsSync(".dockerignore")) {
    const di = fs.readFileSync(".dockerignore", "utf8");
    for (const entry of ["node_modules", ".git", ".env"]) {
      assert(di.includes(entry), `.dockerignore excludes ${entry}`, `${entry} not found in .dockerignore`);
    }
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Docker Build Correctness Regression: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
  process.exit(1);
}
process.exit(0);
