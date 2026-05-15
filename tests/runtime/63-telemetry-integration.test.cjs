"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const ingestor = require("../../agents/runtime/telemetry/telemetryIngestor.cjs");
const norm     = require("../../agents/runtime/telemetry/telemetryNormalizer.cjs");
const health   = require("../../agents/runtime/telemetry/runtimeHealthScorer.cjs");
const windows  = require("../../agents/runtime/telemetry/telemetryWindowManager.cjs");
const snaps    = require("../../agents/runtime/telemetry/telemetrySnapshotStore.cjs");
const pacing   = require("../../agents/runtime/telemetry/telemetryPacingBridge.cjs");

afterEach(() => {
    ingestor.reset();
    norm.reset();
    health.reset();
    windows.reset();
    snaps.reset();
    pacing.reset();
});

// ═══════════════════════════════════════════════════════════════════════
// telemetryIngestor
// ═══════════════════════════════════════════════════════════════════════

describe("telemetryIngestor — ingest", () => {
    it("ingests a valid CPU signal", () => {
        const r = ingestor.ingest("cpu", { value: 0.5 });
        assert.equal(r.ingested, true);
        assert.equal(r.signalType, "cpu");
    });

    it("ingests a valid memory signal with pressureRatio", () => {
        const r = ingestor.ingest("memory", { pressureRatio: 0.7 });
        assert.equal(r.ingested, true);
    });

    it("ingests a valid queue signal", () => {
        const r = ingestor.ingest("queue", { depth: 50, maxCapacity: 100 });
        assert.equal(r.ingested, true);
    });

    it("ingests a valid latency signal", () => {
        const r = ingestor.ingest("latency", { avgMs: 300, p95Ms: 800 });
        assert.equal(r.ingested, true);
    });

    it("ingests failure and retry signals", () => {
        assert.equal(ingestor.ingest("failure",   { rate: 0.1  }).ingested, true);
        assert.equal(ingestor.ingest("retry",     { rate: 0.15 }).ingested, true);
    });

    it("ingests disk, websocket, and api signals", () => {
        assert.equal(ingestor.ingest("disk",      { usedBytes: 80e9, totalBytes: 100e9 }).ingested, true);
        assert.equal(ingestor.ingest("websocket", { dropRate: 0.02, activeConnections: 100 }).ingested, true);
        assert.equal(ingestor.ingest("api",       { errorRate: 0.01, latencyMs: 200 }).ingested, true);
    });

    it("rejects unsupported signal type", () => {
        const r = ingestor.ingest("temperature", { value: 42 });
        assert.equal(r.ingested, false);
        assert.equal(r.reason, "unsupported_signal_type");
    });

    it("rejects CPU signal without value field", () => {
        const r = ingestor.ingest("cpu", { cores: 4 });
        assert.equal(r.ingested, false);
        assert.equal(r.reason, "missing_value");
    });

    it("rejects queue signal without depth", () => {
        const r = ingestor.ingest("queue", { maxCapacity: 100 });
        assert.equal(r.ingested, false);
    });

    it("rejects latency signal without avgMs", () => {
        const r = ingestor.ingest("latency", { p95Ms: 500 });
        assert.equal(r.ingested, false);
    });
});

describe("telemetryIngestor — getSignal and history", () => {
    it("getSignal returns null before any ingest", () => {
        assert.equal(ingestor.getSignal("cpu"), null);
    });

    it("getSignal returns latest ingested payload", () => {
        ingestor.ingest("cpu", { value: 0.3 });
        ingestor.ingest("cpu", { value: 0.7 });
        const s = ingestor.getSignal("cpu");
        assert.equal(s.payload.value, 0.7);
    });

    it("getSignalHistory returns all records in order", () => {
        ingestor.ingest("cpu", { value: 0.2 });
        ingestor.ingest("cpu", { value: 0.4 });
        ingestor.ingest("cpu", { value: 0.6 });
        const h = ingestor.getSignalHistory("cpu", 10);
        assert.equal(h.length, 3);
        assert.equal(h[0].payload.value, 0.2);
        assert.equal(h[2].payload.value, 0.6);
    });

    it("getSignalHistory respects limit", () => {
        for (let i = 0; i < 10; i++) ingestor.ingest("cpu", { value: i / 10 });
        const h = ingestor.getSignalHistory("cpu", 3);
        assert.equal(h.length, 3);
    });
});

describe("telemetryIngestor — batch and stats", () => {
    it("ingestBatch processes multiple signals", () => {
        const r = ingestor.ingestBatch([
            { type: "cpu",    payload: { value: 0.5 } },
            { type: "memory", payload: { pressureRatio: 0.6 } },
            { type: "queue",  payload: { depth: 10 } },
        ]);
        assert.equal(r.total, 3);
        assert.equal(r.ingested, 3);
        assert.equal(r.failed, 0);
    });

    it("ingestBatch counts failures", () => {
        const r = ingestor.ingestBatch([
            { type: "cpu",    payload: { value: 0.5 } },
            { type: "bogus",  payload: { value: 1   } },
        ]);
        assert.equal(r.ingested, 1);
        assert.equal(r.failed, 1);
    });

    it("getIngestStats tracks totals", () => {
        ingestor.ingest("cpu", { value: 0.4 });
        ingestor.ingest("memory", { pressureRatio: 0.5 });
        ingestor.ingest("bogus", {});
        const s = ingestor.getIngestStats();
        assert.equal(s.totalIngested, 2);
        assert.equal(s.totalErrors, 1);
        assert.equal(s.activeSignals, 2);
    });

    it("getSupportedSignals returns all 9 types", () => {
        const sigs = ingestor.getSupportedSignals();
        assert.equal(sigs.length, 9);
        assert.ok(sigs.includes("cpu"));
        assert.ok(sigs.includes("websocket"));
        assert.ok(sigs.includes("api"));
    });
});

// ═══════════════════════════════════════════════════════════════════════
// telemetryNormalizer
// ═══════════════════════════════════════════════════════════════════════

describe("telemetryNormalizer — normalizeCPU", () => {
    it("normalizes a 90% CPU to value 0.9 and critical severity", () => {
        const m = norm.normalizeCPU({ value: 0.9 });
        assert.equal(m.metric, "cpu");
        assert.equal(m.value, 0.9);
        assert.equal(m.severity, "critical");
    });

    it("normalizes low CPU as healthy", () => {
        const m = norm.normalizeCPU({ value: 0.3 });
        assert.equal(m.severity, "healthy");
    });

    it("clamps value to [0, 1]", () => {
        const m = norm.normalizeCPU({ value: 1.5 });
        assert.equal(m.value, 1);
    });
});

describe("telemetryNormalizer — normalizeMemory", () => {
    it("uses pressureRatio when provided", () => {
        const m = norm.normalizeMemory({ pressureRatio: 0.85 });
        assert.equal(m.severity, "degraded");
        assert.ok(m.value >= 0.84 && m.value <= 0.86);
    });

    it("computes ratio from usedBytes/totalBytes", () => {
        const m = norm.normalizeMemory({ usedBytes: 8e9, totalBytes: 10e9 });
        assert.ok(Math.abs(m.value - 0.8) < 0.001);
        assert.equal(m.severity, "degraded");
    });

    it("classifies critical memory pressure", () => {
        const m = norm.normalizeMemory({ pressureRatio: 0.95 });
        assert.equal(m.severity, "critical");
    });
});

describe("telemetryNormalizer — normalizeQueue", () => {
    it("normalizes queue depth ratio", () => {
        const m = norm.normalizeQueue({ depth: 90, maxCapacity: 100 });
        assert.equal(m.value, 0.9);
        assert.equal(m.severity, "critical");
    });

    it("low queue depth is healthy", () => {
        const m = norm.normalizeQueue({ depth: 5, maxCapacity: 100 });
        assert.equal(m.severity, "healthy");
    });

    it("handles missing maxCapacity gracefully", () => {
        const m = norm.normalizeQueue({ depth: 0 });
        assert.equal(m.value, 0);
    });
});

describe("telemetryNormalizer — normalizeLatency", () => {
    it("zero latency excess is healthy", () => {
        const m = norm.normalizeLatency({ avgMs: 100 }, 200);
        assert.equal(m.severity, "healthy");
    });

    it("5× baseline maps to critical", () => {
        const m = norm.normalizeLatency({ avgMs: 1000 }, 200);
        assert.equal(m.severity, "critical");
    });

    it("uses default baseline of 200ms", () => {
        const m = norm.normalizeLatency({ avgMs: 200 });
        assert.equal(m.severity, "healthy");
    });
});

describe("telemetryNormalizer — normalizeFailure / normalizeRetry", () => {
    it("30% failure rate is critical", () => {
        const m = norm.normalizeFailure({ rate: 0.3 });
        assert.equal(m.severity, "critical");
    });

    it("1% failure rate is healthy", () => {
        const m = norm.normalizeFailure({ rate: 0.01 });
        assert.equal(m.severity, "healthy");
    });

    it("50% retry rate is critical", () => {
        const m = norm.normalizeRetry({ rate: 0.5 });
        assert.equal(m.severity, "critical");
    });

    it("computes retry rate from count", () => {
        const m = norm.normalizeRetry({ count: 20 });
        assert.equal(m.value, 0.2);
        // 0.2 < 0.30 threshold for degraded → warning
        assert.equal(m.severity, "warning");
    });
});

describe("telemetryNormalizer — normalizeDisk / normalizeWebsocket / normalizeAPI", () => {
    it("disk: high ioWaitMs is degraded/critical", () => {
        const m = norm.normalizeDisk({ ioWaitMs: 180, usedBytes: 0, totalBytes: 100 });
        assert.ok(["degraded", "critical"].includes(m.severity));
    });

    it("websocket: high drop rate is critical", () => {
        const m = norm.normalizeWebsocket({ dropRate: 0.35 });
        assert.equal(m.severity, "critical");
    });

    it("api: unavailable service is critical", () => {
        const m = norm.normalizeAPI({ available: false, errorRate: 0 });
        assert.equal(m.value, 1.0);
        assert.equal(m.severity, "critical");
    });

    it("api: low error rate is healthy", () => {
        const m = norm.normalizeAPI({ errorRate: 0.01 });
        assert.equal(m.severity, "healthy");
    });
});

describe("telemetryNormalizer — normalizeAll", () => {
    it("normalizes a map of raw signals", () => {
        const signalMap = {
            cpu:    { value: 0.4 },
            memory: { pressureRatio: 0.5 },
            failure: { rate: 0.02 },
        };
        const results = norm.normalizeAll(signalMap);
        assert.equal(results.length, 3);
        assert.ok(results.every(m => m.metric && m.value != null));
    });

    it("ignores unknown signal types in the map", () => {
        const results = norm.normalizeAll({ cpu: { value: 0.3 }, unknown: { data: 1 } });
        assert.equal(results.length, 1);
        assert.equal(results[0].metric, "cpu");
    });
});

describe("telemetryNormalizer — classifySeverity", () => {
    it("classifies CPU thresholds correctly", () => {
        assert.equal(norm.classifySeverity("cpu", 0.95), "critical");
        assert.equal(norm.classifySeverity("cpu", 0.80), "degraded");
        assert.equal(norm.classifySeverity("cpu", 0.65), "warning");
        assert.equal(norm.classifySeverity("cpu", 0.30), "healthy");
    });

    it("returns healthy for unknown metric", () => {
        assert.equal(norm.classifySeverity("unknown_metric", 0.99), "healthy");
    });
});

// ═══════════════════════════════════════════════════════════════════════
// runtimeHealthScorer
// ═══════════════════════════════════════════════════════════════════════

describe("runtimeHealthScorer — computeHealthScore", () => {
    it("returns perfect score with no metrics", () => {
        const r = health.computeHealthScore([]);
        assert.equal(r.score, 100);
        assert.equal(r.grade, "A");
        assert.equal(r.level, "healthy");
    });

    it("scores healthy for all-healthy metrics", () => {
        const metrics = [
            { metric: "cpu",     value: 0.2, severity: "healthy" },
            { metric: "memory",  value: 0.3, severity: "healthy" },
            { metric: "failure", value: 0.01, severity: "healthy" },
        ];
        const r = health.computeHealthScore(metrics);
        assert.ok(r.score >= 70);
        assert.ok(["healthy", "warning"].includes(r.level));
    });

    it("scores critically low for all-critical metrics", () => {
        const metrics = [
            { metric: "cpu",     value: 0.95, severity: "critical" },
            { metric: "memory",  value: 0.92, severity: "critical" },
            { metric: "failure", value: 0.4,  severity: "critical" },
        ];
        const r = health.computeHealthScore(metrics);
        assert.ok(r.score < 40);
        assert.equal(r.hasCritical, true);
        assert.equal(r.level, "critical");
    });

    it("identifies critical and degraded flags", () => {
        const metrics = [
            { metric: "cpu",    value: 0.5,  severity: "degraded"  },
            { metric: "memory", value: 0.92, severity: "critical"  },
        ];
        const r = health.computeHealthScore(metrics);
        assert.equal(r.hasCritical, true);
        assert.equal(r.hasDegraded, true);
        assert.equal(r.criticalCount, 1);
    });

    it("stores result in score history", () => {
        health.computeHealthScore([{ metric: "cpu", value: 0.5, severity: "warning" }]);
        assert.equal(health.getScoreHistory().length, 1);
    });
});

describe("runtimeHealthScorer — adaptWeights", () => {
    it("returns base weights when no critical metrics", () => {
        const metrics  = [{ metric: "cpu", value: 0.3, severity: "healthy" }];
        const weights  = health.adaptWeights(metrics);
        const base     = health.getWeights();
        // Weights should still be distributed (renormalized but CPU shouldn't be amplified)
        assert.ok(Object.values(weights).every(w => w > 0));
    });

    it("amplifies critical metric weight above base", () => {
        const baseWeights = health.getWeights();
        const critical = [{ metric: "failure", value: 0.9, severity: "critical" }];
        const adapted  = health.adaptWeights(critical);
        // failure weight should be proportionally higher after amplification
        assert.ok(adapted.failure > baseWeights.failure);
    });

    it("weights sum to approximately 1 after adaptation", () => {
        const metrics = [
            { metric: "cpu",     value: 0.9, severity: "critical" },
            { metric: "memory",  value: 0.85, severity: "degraded" },
        ];
        const weights = health.adaptWeights(metrics);
        const sum = Object.values(weights).reduce((s, w) => s + w, 0);
        assert.ok(Math.abs(sum - 1.0) < 0.01);
    });
});

describe("runtimeHealthScorer — scoreSignal", () => {
    it("scores a healthy signal as A", () => {
        const r = health.scoreSignal({ metric: "cpu", value: 0.05, severity: "healthy" });
        assert.ok(r.score >= 90);
        assert.equal(r.grade, "A");
    });

    it("scores a critical signal as F", () => {
        const r = health.scoreSignal({ metric: "memory", value: 0.95, severity: "critical" });
        assert.ok(r.score < 20);
        assert.equal(r.grade, "F");
    });
});

// ═══════════════════════════════════════════════════════════════════════
// telemetryWindowManager
// ═══════════════════════════════════════════════════════════════════════

describe("telemetryWindowManager — addSample and getWindow", () => {
    it("returns unavailable for empty metric", () => {
        const r = windows.getWindow("cpu", 60000);
        assert.equal(r.available, false);
    });

    it("computes stats for samples within window", () => {
        const now = Date.now();
        windows.addSample("cpu", 0.3, now - 10000);
        windows.addSample("cpu", 0.5, now - 5000);
        windows.addSample("cpu", 0.4, now - 1000);
        const r = windows.getWindow("cpu", 60000, now);
        assert.equal(r.available, true);
        assert.equal(r.count, 3);
        assert.ok(r.avg > 0);
    });

    it("excludes samples outside window", () => {
        const now = Date.now();
        windows.addSample("cpu", 0.9, now - 120000);   // outside 1min window
        windows.addSample("cpu", 0.2, now - 5000);     // inside 1min window
        const r = windows.getWindow("cpu", 60000, now);
        assert.equal(r.count, 1);
        assert.ok(Math.abs(r.avg - 0.2) < 0.001);
    });

    it("getAllWindowStats returns all 4 window labels", () => {
        const now = Date.now();
        windows.addSample("memory", 0.5, now - 1000);
        const r = windows.getAllWindowStats("memory", now);
        assert.ok("1m" in r && "5m" in r && "15m" in r && "1h" in r);
    });
});

describe("telemetryWindowManager — detectSpike", () => {
    it("returns insufficient_samples with fewer than 3 samples", () => {
        const now = Date.now();
        windows.addSample("cpu", 0.3, now - 1000);
        windows.addSample("cpu", 0.4, now - 500);
        const r = windows.detectSpike("cpu", 60000, now);
        assert.equal(r.spiked, false);
        assert.equal(r.reason, "insufficient_samples");
    });

    it("detects spike when latest value is far above mean", () => {
        const now = Date.now();
        // Establish baseline around 0.3
        for (let i = 20; i >= 2; i--) {
            windows.addSample("cpu", 0.3 + (Math.random() * 0.02 - 0.01), now - i * 2000);
        }
        // Inject spike
        windows.addSample("cpu", 0.98, now - 500);
        const r = windows.detectSpike("cpu", 300000, now);
        assert.equal(r.spiked, true);
        assert.ok(r.magnitude > 2);
    });

    it("does not flag stable signal as spike", () => {
        const now = Date.now();
        for (let i = 10; i >= 1; i--) {
            windows.addSample("cpu", 0.5, now - i * 5000);
        }
        const r = windows.detectSpike("cpu", 300000, now);
        assert.equal(r.spiked, false);
    });
});

describe("telemetryWindowManager — analyzeTrend", () => {
    it("returns stable for insufficient samples", () => {
        const now = Date.now();
        windows.addSample("failure", 0.1, now - 1000);
        windows.addSample("failure", 0.2, now - 500);
        const r = windows.analyzeTrend("failure", 60000, now);
        assert.equal(r.direction, "stable");
    });

    it("detects degrading trend for steadily rising values", () => {
        const now = Date.now();
        // Rising from 0.1 to 0.9 over 15 samples
        for (let i = 15; i >= 1; i--) {
            const v = 0.1 + ((15 - i) / 14) * 0.8;
            windows.addSample("failure", v, now - i * 10000);
        }
        const r = windows.analyzeTrend("failure", 300000, now);
        assert.ok(["degrading", "unstable"].includes(r.direction));
    });

    it("detects improving trend for steadily falling values", () => {
        const now = Date.now();
        for (let i = 15; i >= 1; i--) {
            const v = 0.9 - ((15 - i) / 14) * 0.8;
            windows.addSample("cpu", v, now - i * 10000);
        }
        const r = windows.analyzeTrend("cpu", 300000, now);
        assert.ok(["improving", "stable"].includes(r.direction));
    });

    it("detects unstable for highly variable signal", () => {
        const now = Date.now();
        for (let i = 20; i >= 1; i--) {
            const v = i % 2 === 0 ? 0.9 : 0.1;   // alternating high/low
            windows.addSample("cpu", v, now - i * 5000);
        }
        const r = windows.analyzeTrend("cpu", 300000, now);
        assert.ok(["unstable", "degrading", "improving"].includes(r.direction));
    });

    it("returns slope and cv in result", () => {
        const now = Date.now();
        for (let i = 10; i >= 1; i--) {
            windows.addSample("retry", 0.3, now - i * 5000);
        }
        const r = windows.analyzeTrend("retry", 300000, now);
        assert.ok("slope" in r);
        assert.ok("cv" in r);
    });
});

describe("telemetryWindowManager — getWindowSummary", () => {
    it("returns spike and trend in summary", () => {
        const now = Date.now();
        for (let i = 20; i >= 1; i--) {
            windows.addSample("memory", 0.5, now - i * 5000);
        }
        const r = windows.getWindowSummary("memory", now);
        assert.equal(r.metric, "memory");
        assert.ok("spike" in r);
        assert.ok("trend" in r);
        assert.ok("windows" in r);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// telemetrySnapshotStore
// ═══════════════════════════════════════════════════════════════════════

describe("telemetrySnapshotStore — takeSnapshot", () => {
    it("creates a snapshot with sequential IDs", () => {
        const s1 = snaps.takeSnapshot({ score: 80, level: "healthy" }, [], {});
        const s2 = snaps.takeSnapshot({ score: 70, level: "warning"  }, [], {});
        assert.ok(s1.snapshotId.startsWith("snap-"));
        assert.notEqual(s1.snapshotId, s2.snapshotId);
    });

    it("stores metrics and context in snapshot", () => {
        const metrics = [{ metric: "cpu", value: 0.4, severity: "warning" }];
        const s = snaps.takeSnapshot({ score: 75 }, metrics, { trend: "stable" });
        assert.equal(s.metricCount, 1);
        assert.equal(s.context.trend, "stable");
    });
});

describe("telemetrySnapshotStore — getSnapshot / getLatestSnapshot", () => {
    it("returns null for unknown snapshotId", () => {
        assert.equal(snaps.getSnapshot("snap-999"), null);
    });

    it("getLatestSnapshot returns null when empty", () => {
        assert.equal(snaps.getLatestSnapshot(), null);
    });

    it("retrieves snapshot by id", () => {
        const s = snaps.takeSnapshot({ score: 90, level: "healthy" }, []);
        const fetched = snaps.getSnapshot(s.snapshotId);
        assert.equal(fetched.snapshotId, s.snapshotId);
        assert.equal(fetched.healthScore.score, 90);
    });

    it("getLatestSnapshot returns the most recent", () => {
        snaps.takeSnapshot({ score: 80 }, []);
        snaps.takeSnapshot({ score: 60 }, []);
        const latest = snaps.getLatestSnapshot();
        assert.equal(latest.healthScore.score, 60);
    });
});

describe("telemetrySnapshotStore — compareSnapshots", () => {
    it("returns compared:false for missing snapshot", () => {
        const s = snaps.takeSnapshot({ score: 80 }, []);
        const r = snaps.compareSnapshots(s.snapshotId, "snap-999");
        assert.equal(r.compared, false);
    });

    it("detects worsened direction", () => {
        const s1 = snaps.takeSnapshot({ score: 85 }, []);
        const s2 = snaps.takeSnapshot({ score: 55 }, []);
        const r  = snaps.compareSnapshots(s1.snapshotId, s2.snapshotId);
        assert.equal(r.compared, true);
        assert.equal(r.direction, "worsened");
        assert.ok(r.scoreDelta < 0);
    });

    it("detects improved direction", () => {
        const s1 = snaps.takeSnapshot({ score: 50 }, []);
        const s2 = snaps.takeSnapshot({ score: 85 }, []);
        const r  = snaps.compareSnapshots(s1.snapshotId, s2.snapshotId);
        assert.equal(r.direction, "improved");
    });

    it("detects stable when delta is small", () => {
        const s1 = snaps.takeSnapshot({ score: 80 }, []);
        const s2 = snaps.takeSnapshot({ score: 82 }, []);
        const r  = snaps.compareSnapshots(s1.snapshotId, s2.snapshotId);
        assert.equal(r.direction, "stable");
    });
});

describe("telemetrySnapshotStore — checkEscalation", () => {
    it("returns escalate:false for healthy snapshot", () => {
        const s = snaps.takeSnapshot({ score: 90, level: "healthy", hasCritical: false }, []);
        const r = snaps.checkEscalation(s);
        assert.equal(r.escalate, false);
    });

    it("escalates critical_health for score < 40", () => {
        const s = snaps.takeSnapshot({ score: 30, level: "critical", hasCritical: true }, []);
        const r = snaps.checkEscalation(s);
        assert.equal(r.escalate, true);
        assert.equal(r.ruleId, "critical_health");
        assert.equal(r.level, "critical");
    });

    it("escalates degraded_with_critical_metric for score < 60 and hasCritical", () => {
        const s = snaps.takeSnapshot({ score: 55, level: "degraded", hasCritical: true }, []);
        const r = snaps.checkEscalation(s);
        assert.equal(r.escalate, true);
        assert.ok(["degraded_with_critical_metric", "critical_health"].includes(r.ruleId));
    });

    it("escalates warning_with_trend for degrading trend", () => {
        const s = snaps.takeSnapshot({ score: 70, level: "warning", hasCritical: false }, [], { trend: "degrading" });
        const r = snaps.checkEscalation(s);
        assert.equal(r.escalate, true);
        assert.equal(r.ruleId, "warning_with_trend");
    });

    it("escalates sustained_degradation after 3 consecutive degraded snapshots", () => {
        // Need 3+ history entries with score < 60
        snaps.takeSnapshot({ score: 55, level: "degraded" }, []);
        snaps.takeSnapshot({ score: 50, level: "degraded" }, []);
        snaps.takeSnapshot({ score: 52, level: "degraded" }, []);
        const s4 = snaps.takeSnapshot({ score: 48, level: "degraded" }, []);
        const r  = snaps.checkEscalation(s4);
        assert.equal(r.escalate, true);
        // Either sustained_degradation or critical_health triggers
        assert.ok(["sustained_degradation", "critical_health", "degraded_with_critical_metric"].includes(r.ruleId));
    });

    it("records escalations in history", () => {
        const s = snaps.takeSnapshot({ score: 25, level: "critical" }, []);
        snaps.checkEscalation(s);
        const h = snaps.getEscalationHistory();
        assert.equal(h.length, 1);
        assert.equal(h[0].healthScore, 25);
    });
});

describe("telemetrySnapshotStore — listSnapshots", () => {
    it("lists snapshots with limit", () => {
        for (let i = 0; i < 10; i++) snaps.takeSnapshot({ score: 80 }, []);
        const list = snaps.listSnapshots(3);
        assert.equal(list.length, 3);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// telemetryPacingBridge
// ═══════════════════════════════════════════════════════════════════════

describe("telemetryPacingBridge — computePacingSignal", () => {
    it("returns no pressure for healthy score", () => {
        const r = pacing.computePacingSignal({ score: 90, level: "healthy" }, []);
        assert.equal(r.pressure, "none");
        assert.equal(r.multiplier, 1.0);
        assert.equal(r.blockFastTrack, false);
    });

    it("escalates to critical for critical CPU", () => {
        const metrics = [{ metric: "cpu", value: 0.95, severity: "critical" }];
        const r = pacing.computePacingSignal({ score: 50, level: "degraded" }, metrics);
        assert.equal(r.effectivePressure ?? r.pressure, "critical");
        assert.ok(r.multiplier >= 5.0);
    });

    it("escalates to high pressure for critical latency", () => {
        const metrics = [{ metric: "latency", value: 0.9, severity: "critical" }];
        const r = pacing.computePacingSignal({ score: 70, level: "warning" }, metrics);
        assert.ok(["high", "critical"].includes(r.pressure));
    });

    it("blocks fast track for degraded level", () => {
        const r = pacing.computePacingSignal({ score: 50, level: "degraded" }, []);
        assert.equal(r.blockFastTrack, true);
    });

    it("blocks fast track when critical metrics present", () => {
        const metrics = [{ metric: "memory", value: 0.95, severity: "critical" }];
        const r = pacing.computePacingSignal({ score: 65, level: "warning" }, metrics);
        assert.equal(r.blockFastTrack, true);
    });
});

describe("telemetryPacingBridge — translateToPacingConfig", () => {
    it("maps no pressure to fast strategy", () => {
        const r = pacing.translateToPacingConfig({ pressure: "none", multiplier: 1.0, blockFastTrack: false });
        assert.equal(r.strategy, "fast");
        assert.equal(r.allowFastTrack, true);
        assert.ok(r.maxConcurrency >= 8);
    });

    it("maps critical pressure to recovery_first and concurrency 1", () => {
        const r = pacing.translateToPacingConfig({ pressure: "critical", multiplier: 5.0, blockFastTrack: true });
        assert.equal(r.strategy, "recovery_first");
        assert.equal(r.maxConcurrency, 1);
        assert.equal(r.allowFastTrack, false);
    });

    it("maps high pressure to staged strategy", () => {
        const r = pacing.translateToPacingConfig({ pressure: "high", multiplier: 2.5, blockFastTrack: false });
        assert.equal(r.strategy, "staged");
        assert.ok(r.maxConcurrency <= 3);
    });
});

describe("telemetryPacingBridge — shouldFastTrack", () => {
    it("allows fast-track for healthy high-score execution", () => {
        const r = pacing.shouldFastTrack("fp-safe", { score: 95, level: "healthy", hasCritical: false });
        assert.equal(r.allowed, true);
    });

    it("denies fast-track for degraded level", () => {
        const r = pacing.shouldFastTrack("fp-risky", { score: 55, level: "degraded" });
        assert.equal(r.allowed, false);
        assert.equal(r.reason, "infrastructure_pressure");
    });

    it("denies fast-track when hasCritical is true", () => {
        const r = pacing.shouldFastTrack("fp-crit", { score: 70, level: "warning", hasCritical: true });
        assert.equal(r.allowed, false);
    });

    it("denies fast-track for low health score even without critical signals", () => {
        const r = pacing.shouldFastTrack("fp-low", { score: 50, level: "warning", hasCritical: false });
        assert.equal(r.allowed, false);
    });

    it("tracks fast-track hits and denials in stats", () => {
        pacing.shouldFastTrack("fp1", { score: 95, level: "healthy" });
        pacing.shouldFastTrack("fp2", { score: 30, level: "critical" });
        const s = pacing.getPacingBridgeStats();
        assert.equal(s.fastTrackHits,    1);
        assert.equal(s.fastTrackDenials, 1);
    });
});

describe("telemetryPacingBridge — shouldThrottle", () => {
    it("does not throttle for healthy metrics", () => {
        const r = pacing.shouldThrottle({ score: 90, level: "healthy" }, []);
        assert.equal(r.throttle, false);
        assert.equal(r.intensity, "none");
    });

    it("throttles moderately for single critical signal", () => {
        const metrics = [{ metric: "cpu", severity: "critical" }];
        const r = pacing.shouldThrottle({ score: 65, level: "warning" }, metrics);
        assert.equal(r.throttle, true);
        assert.equal(r.intensity, "moderate");
    });

    it("throttles aggressively for multiple critical signals", () => {
        const metrics = [
            { metric: "cpu",     severity: "critical" },
            { metric: "memory",  severity: "critical" },
            { metric: "failure", severity: "critical" },
        ];
        const r = pacing.shouldThrottle({ score: 20, level: "critical" }, metrics);
        assert.equal(r.throttle, true);
        assert.equal(r.intensity, "aggressive");
    });

    it("throttles lightly for degraded level with no critical signals", () => {
        const r = pacing.shouldThrottle({ score: 55, level: "degraded" }, []);
        assert.equal(r.throttle, true);
        assert.equal(r.intensity, "light");
    });
});

describe("telemetryPacingBridge — getEffectivePaceMultiplier", () => {
    it("returns 1.0 for healthy level", () => {
        assert.equal(pacing.getEffectivePaceMultiplier({ level: "healthy" }), 1.0);
    });

    it("returns highest multiplier for critical level", () => {
        const m = pacing.getEffectivePaceMultiplier({ level: "critical" });
        assert.ok(m >= 5.0);
    });

    it("returns intermediate multiplier for warning level", () => {
        const m = pacing.getEffectivePaceMultiplier({ level: "warning" });
        assert.ok(m > 1.0 && m < 5.0);
    });
});

describe("telemetryPacingBridge — getPacingBridgeStats", () => {
    it("tracks signal count after computePacingSignal", () => {
        pacing.computePacingSignal({ score: 80, level: "healthy" }, []);
        pacing.computePacingSignal({ score: 40, level: "critical" }, []);
        const s = pacing.getPacingBridgeStats();
        assert.equal(s.signalCount, 2);
    });

    it("tracks throttle count", () => {
        pacing.shouldThrottle({ score: 20, level: "critical" }, []);
        const s = pacing.getPacingBridgeStats();
        assert.equal(s.throttleCount, 1);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Stress simulation — full telemetry pipeline
// ═══════════════════════════════════════════════════════════════════════

describe("telemetry pipeline — stress simulation", () => {
    it("simulates a degrading system over time and detects trend", () => {
        const now = Date.now();
        // Simulate gradually increasing failure rate
        for (let i = 30; i >= 1; i--) {
            const failRate = 0.01 + ((30 - i) / 29) * 0.35;
            const cpuVal   = 0.3  + ((30 - i) / 29) * 0.6;
            windows.addSample("failure", failRate, now - i * 8000);
            windows.addSample("cpu",     cpuVal,   now - i * 8000);
        }
        const failTrend = windows.analyzeTrend("failure", 300000, now);
        assert.ok(["degrading", "unstable"].includes(failTrend.direction));
        const cpuTrend = windows.analyzeTrend("cpu", 300000, now);
        assert.ok(["degrading", "unstable"].includes(cpuTrend.direction));
    });

    it("simulates a recovering system and detects improvement", () => {
        const now = Date.now();
        for (let i = 20; i >= 1; i--) {
            const failRate = 0.5 - ((20 - i) / 19) * 0.45;
            windows.addSample("failure", failRate, now - i * 8000);
        }
        const trend = windows.analyzeTrend("failure", 300000, now);
        assert.ok(["improving", "stable"].includes(trend.direction));
    });

    it("full pipeline: ingest → normalize → score → snapshot → escalation", () => {
        // Step 1: ingest raw signals
        ingestor.ingest("cpu",     { value: 0.92 });
        ingestor.ingest("memory",  { pressureRatio: 0.88 });
        ingestor.ingest("failure", { rate: 0.25 });

        // Step 2: normalize
        const rawSignals = {
            cpu:     ingestor.getSignal("cpu").payload,
            memory:  ingestor.getSignal("memory").payload,
            failure: ingestor.getSignal("failure").payload,
        };
        const metrics = norm.normalizeAll(rawSignals);
        assert.equal(metrics.length, 3);
        assert.ok(metrics.some(m => m.severity === "critical"));

        // Step 3: compute health score
        const hs = health.computeHealthScore(metrics);
        assert.ok(hs.score < 50);
        assert.equal(hs.hasCritical, true);

        // Step 4: take snapshot
        const snap = snaps.takeSnapshot(hs, metrics, { trend: "degrading" });
        assert.ok(snap.snapshotId);

        // Step 5: check escalation
        const esc = snaps.checkEscalation(snap);
        assert.equal(esc.escalate, true);

        // Step 6: pacing bridge
        const signal = pacing.computePacingSignal(hs, metrics);
        assert.ok(signal.blockFastTrack);
        assert.ok(signal.multiplier > 1);

        const config = pacing.translateToPacingConfig(signal);
        assert.notEqual(config.strategy, "fast");
        assert.ok(config.maxConcurrency <= 3);
    });

    it("spike detection triggers even when window average looks healthy", () => {
        const now = Date.now();
        // Establish stable baseline
        for (let i = 30; i >= 2; i--) {
            windows.addSample("latency", 0.2, now - i * 3000);
        }
        // Inject sudden spike (not yet in window average)
        windows.addSample("latency", 0.95, now - 100);
        const r = windows.detectSpike("latency", 300000, now);
        assert.equal(r.spiked, true);
        assert.ok(r.avg < 0.3);   // average still looks healthy
        assert.ok(r.latest > 0.9);  // but latest is spiked
    });

    it("batch ingest all 9 signal types and produce a health score", () => {
        ingestor.ingestBatch([
            { type: "cpu",       payload: { value: 0.55 } },
            { type: "memory",    payload: { pressureRatio: 0.60 } },
            { type: "queue",     payload: { depth: 60, maxCapacity: 100 } },
            { type: "latency",   payload: { avgMs: 350 } },
            { type: "retry",     payload: { rate: 0.08 } },
            { type: "failure",   payload: { rate: 0.03 } },
            { type: "disk",      payload: { usedBytes: 70e9, totalBytes: 100e9 } },
            { type: "websocket", payload: { dropRate: 0.005 } },
            { type: "api",       payload: { errorRate: 0.01 } },
        ]);

        const stats = ingestor.getIngestStats();
        assert.equal(stats.totalIngested, 9);
        assert.equal(stats.activeSignals, 9);

        const signalMap = {};
        for (const t of ingestor.getSupportedSignals()) {
            const s = ingestor.getSignal(t);
            if (s) signalMap[t] = s.payload;
        }
        const metrics = norm.normalizeAll(signalMap);
        const hs      = health.computeHealthScore(metrics);
        assert.ok(hs.score > 0 && hs.score <= 100);
        assert.ok(["healthy", "warning", "degraded", "critical"].includes(hs.level));
    });
});
