"use strict";
/**
 * B.20 — chaos recovery regression.
 *
 * Guards the findings this phase reproduced live. Each test asserts a property
 * that was actually measured against the running application, not an
 * aspiration.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// signJWT/verifyJWT require JWT_SECRET. Load the real env the same way the
// server does, rather than stubbing a secret — a stub would let these tests
// pass against a build whose signing config is broken.
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const MISSIONS = path.join(DATA_DIR, "missions.json");

describe("B.20 — orphaned tmp sweep (interrupted-write recovery)", () => {
  it("removes an aged orphan matching the missions tmp shape", () => {
    // Reproduces the measured defect: a process killed between writeFileSync
    // and renameSync leaves `missions.json.<pid>.<hex>.tmp` behind forever.
    // Two such orphans (~11 MB) were found on this repo during B.20.
    const orphan = path.join(DATA_DIR, `missions.json.999999.deadbeefcafe.tmp`);
    fs.writeFileSync(orphan, "x".repeat(1024));
    // Age it past the grace window so the sweep treats it as abandoned.
    const old = Date.now() - 10 * 60 * 1000;
    fs.utimesSync(orphan, old / 1000, old / 1000);

    delete require.cache[require.resolve("../../backend/services/missionMemory.cjs")];
    require("../../backend/services/missionMemory.cjs");

    assert.equal(fs.existsSync(orphan), false,
      "aged orphaned tmp file should have been swept at module load");
  });

  it("does NOT remove a tmp file young enough to be an in-flight write", () => {
    // A concurrent writer's tmp must survive — deleting it would reintroduce
    // the ENOENT-on-rename class the unique-tmp-name fix was written to kill.
    const live = path.join(DATA_DIR, `missions.json.888888.feedfacebeef.tmp`);
    fs.writeFileSync(live, "y".repeat(512));
    try {
      delete require.cache[require.resolve("../../backend/services/missionMemory.cjs")];
      require("../../backend/services/missionMemory.cjs");
      assert.equal(fs.existsSync(live), true,
        "a freshly written tmp may belong to a live write and must not be swept");
    } finally {
      try { fs.unlinkSync(live); } catch { /* already gone */ }
    }
  });

  it("does not touch unrelated files in the data directory", () => {
    // The sweep is regex-scoped to this store's own tmp shape. A different
    // service's tmp, or a real data file, must be left alone.
    const foreign = path.join(DATA_DIR, "someOtherStore.json.123.abc.tmp");
    const realFile = path.join(DATA_DIR, "b20-sweep-guard.json");
    fs.writeFileSync(foreign, "{}");
    fs.writeFileSync(realFile, "{}");
    const old = Date.now() - 10 * 60 * 1000;
    fs.utimesSync(foreign, old / 1000, old / 1000);
    fs.utimesSync(realFile, old / 1000, old / 1000);
    try {
      delete require.cache[require.resolve("../../backend/services/missionMemory.cjs")];
      require("../../backend/services/missionMemory.cjs");
      assert.equal(fs.existsSync(foreign), true, "another service's tmp must not be swept");
      assert.equal(fs.existsSync(realFile), true, "a real data file must never be swept");
    } finally {
      try { fs.unlinkSync(foreign); } catch {}
      try { fs.unlinkSync(realFile); } catch {}
    }
  });

  it("leaves the real missions store intact and parseable", () => {
    // The sweep must never be able to damage the store it protects.
    //
    // Mission 67: on a fresh checkout data/missions.json is gitignored and
    // does not exist until something writes a real mission — _loadMissions()
    // tolerates ENOENT in-memory but never persists that empty store to disk,
    // so requiring this module alone does not create the file. This test has
    // no dependency on any other file's ordering (it is not in
    // MISSION_MUTATING and runs in the parallel batch), so it must guarantee
    // its own precondition rather than assume some other test already
    // created a mission first. Seeded via the module's own real
    // createMission(), the same convention already used elsewhere in this
    // repo's test suite for this exact gap.
    delete require.cache[require.resolve("../../backend/services/missionMemory.cjs")];
    const mm = require("../../backend/services/missionMemory.cjs");
    let seeded = null;
    if (!fs.existsSync(MISSIONS)) {
      seeded = mm.createMission({ objective: "B20 sweep-guard seed mission" });
    }
    try {
      assert.equal(fs.existsSync(MISSIONS), true, "missions.json must still exist");
      const parsed = JSON.parse(fs.readFileSync(MISSIONS, "utf8"));
      assert.equal(Array.isArray(parsed.missions), true, "missions.json must still parse");
    } finally {
      if (seeded) {
        const store = JSON.parse(fs.readFileSync(MISSIONS, "utf8"));
        store.missions = store.missions.filter((m) => m.id !== seeded.id);
        fs.writeFileSync(MISSIONS, JSON.stringify(store, null, 2));
      }
    }
  });
});

describe("B.20 — frontend import integrity (build gate)", () => {
  // The production build was broken at the B.20 baseline commit:
  //   "Attempted import error: 'getTasks' is not exported from '../api'"
  // useRuntimeStream.js imported getTasks from ../api, but that symbol lives
  // in personalApi.js (a different module, different signature). A broken
  // import is a total build failure, not a degraded feature, so it is guarded
  // here rather than left to the next person to rediscover.
  const SRC = path.join(__dirname, "..", "..", "frontend", "src");

  /** Names imported from a module specifier in a given file. */
  function namedImports(file, specifier) {
    const src = fs.readFileSync(file, "utf8");
    const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`);
    const m = src.match(re);
    if (!m) return [];
    return m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
  }

  /** Symbols api.js provides, following its `export * from` re-exports. */
  function apiSurface() {
    const apiFile = path.join(SRC, "api.js");
    const src = fs.readFileSync(apiFile, "utf8");
    const names = new Set();
    for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) names.add(m[1]);
    for (const m of src.matchAll(/export\s+(?:const|let|var)\s+(\w+)/g)) names.add(m[1]);
    for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(",")) {
        const as = part.trim().split(/\s+as\s+/);
        const name = (as[1] || as[0] || "").trim();
        if (name) names.add(name);
      }
    }
    // Follow `export * from "./x"` re-exports one level.
    for (const m of src.matchAll(/export\s*\*\s*from\s*['"]\.\/([\w.-]+)['"]/g)) {
      const dep = path.join(SRC, m[1].endsWith(".js") ? m[1] : `${m[1]}.js`);
      if (!fs.existsSync(dep)) continue;
      const ds = fs.readFileSync(dep, "utf8");
      for (const d of ds.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) names.add(d[1]);
      for (const d of ds.matchAll(/export\s+(?:const|let|var)\s+(\w+)/g)) names.add(d[1]);
    }
    return names;
  }

  it("useRuntimeStream imports only symbols ../api actually exports", () => {
    const file = path.join(SRC, "hooks", "useRuntimeStream.js");
    const imported = namedImports(file, "../api");
    assert.ok(imported.length > 0, "expected named imports from ../api");
    const surface = apiSurface();
    const missing = imported.filter((n) => !surface.has(n));
    assert.deepEqual(missing, [],
      `useRuntimeStream imports symbol(s) ../api does not export: ${missing.join(", ")} — this breaks the production build`);
  });
});

describe("B.20 — auth boundary under failure", () => {
  const AUTH = path.join(__dirname, "..", "..", "backend", "middleware", "authMiddleware.js");

  it("rejects an expired token (measured live as 401)", () => {
    const { signJWT, verifyJWT } = require(AUTH);
    const expired = signJWT({ role: "operator", sub: "b20", exp: Math.floor(Date.now() / 1000) - 3600 });
    assert.equal(verifyJWT(expired), null, "an expired token must not verify");
  });

  it("rejects a tampered signature (measured live as 401)", () => {
    const { signJWT, verifyJWT } = require(AUTH);
    const good = signJWT({ role: "operator", sub: "b20" });
    const forged = good.slice(0, -1) + (good.slice(-1) === "A" ? "B" : "A");
    assert.equal(verifyJWT(forged), null, "a forged signature must not verify");
  });

  it("reads the session token only from the cookie, never from a header", () => {
    // This is why tests/chaos/01-controlled-chaos.cjs reports 0 successes on
    // every scenario: it authenticates with an `x-auth-token` HEADER, which
    // this middleware deliberately ignores. Recorded so the harness defect is
    // not rediscovered as a product defect.
    const src = fs.readFileSync(AUTH, "utf8");
    assert.match(src, /_parseCookies\(req\)/, "requireAuth must read the cookie jar");
    assert.doesNotMatch(src, /headers\[["']x-auth-token["']\]/,
      "the auth middleware must not accept a bearer-style auth header");
  });
});
