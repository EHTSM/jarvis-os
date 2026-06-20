"use strict";
/**
 * Creative Job Queue — tracks all creative generation jobs.
 *
 * States: queued → running → complete | failed
 * Stores per-job: capability, provider, model, prompt, progress,
 *                 output asset id, error, duration.
 *
 * Storage: data/creative-jobs.json
 */

const fs   = require("fs");
const path = require("path");

const STORE_FILE = path.join(__dirname, "../../data/creative-jobs.json");
const MAX_JOBS   = 500;

function _load() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); }
  catch { return { jobs: {} }; }
}

function _save(d) {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    const jobs  = d.jobs;
    const keys  = Object.keys(jobs).sort((a, b) => (jobs[b].createdAt || "") > (jobs[a].createdAt || "") ? 1 : -1);
    if (keys.length > MAX_JOBS) {
      const pruned = {};
      keys.slice(0, MAX_JOBS).forEach(k => { pruned[k] = jobs[k]; });
      d.jobs = pruned;
    }
    fs.writeFileSync(STORE_FILE, JSON.stringify(d, null, 2));
  } catch { /* non-fatal */ }
}

function _id() { return `job-${Date.now()}-${Math.random().toString(36).slice(2,5)}`; }

// ── Job lifecycle ──────────────────────────────────────────────────

function createJob(opts = {}) {
  const store = _load();
  const id    = _id();
  const job   = {
    id,
    status:      "queued",
    capability:  opts.capability  || "image_generate",
    provider:    opts.provider    || "unknown",
    model:       opts.model       || "",
    prompt:      opts.prompt      || "",
    accountId:   opts.accountId   || null,
    params:      opts.params      || {},
    assetId:     null,
    outputUrl:   null,
    error:       null,
    progress:    0,
    creditsUsed: 0,
    startedAt:   null,
    completedAt: null,
    durationMs:  null,
    createdAt:   new Date().toISOString(),
    studioType:  opts.studioType  || "image",
  };
  store.jobs[id] = job;
  _save(store);
  return job;
}

function startJob(id) {
  const store = _load();
  if (!store.jobs[id]) return null;
  store.jobs[id].status    = "running";
  store.jobs[id].startedAt = new Date().toISOString();
  store.jobs[id].progress  = 5;
  _save(store);
  return store.jobs[id];
}

function updateProgress(id, progress) {
  const store = _load();
  if (!store.jobs[id]) return null;
  store.jobs[id].progress = Math.min(99, progress);
  _save(store);
  return store.jobs[id];
}

function completeJob(id, opts = {}) {
  const store = _load();
  if (!store.jobs[id]) return null;
  const job = store.jobs[id];
  job.status      = "complete";
  job.progress    = 100;
  job.assetId     = opts.assetId   || null;
  job.outputUrl   = opts.outputUrl  || null;
  job.creditsUsed = opts.credits    || 0;
  job.completedAt = new Date().toISOString();
  job.durationMs  = job.startedAt ? Date.now() - new Date(job.startedAt).getTime() : null;
  _save(store);
  return job;
}

function failJob(id, error) {
  const store = _load();
  if (!store.jobs[id]) return null;
  const job = store.jobs[id];
  job.status      = "failed";
  job.error       = String(error).slice(0, 500);
  job.completedAt = new Date().toISOString();
  job.durationMs  = job.startedAt ? Date.now() - new Date(job.startedAt).getTime() : null;
  _save(store);
  return job;
}

function getJob(id) { return _load().jobs[id] || null; }

function listJobs(opts = {}) {
  const store = _load();
  let   list  = Object.values(store.jobs);
  if (opts.status)     list = list.filter(j => j.status === opts.status);
  if (opts.accountId)  list = list.filter(j => j.accountId === opts.accountId);
  if (opts.studioType) list = list.filter(j => j.studioType === opts.studioType);
  return list.sort((a, b) => (b.createdAt || "") > (a.createdAt || "") ? 1 : -1)
             .slice(0, opts.limit || 50);
}

function getSummary() {
  const store = _load();
  const list  = Object.values(store.jobs);
  return {
    queued:   list.filter(j => j.status === "queued").length,
    running:  list.filter(j => j.status === "running").length,
    complete: list.filter(j => j.status === "complete").length,
    failed:   list.filter(j => j.status === "failed").length,
    total:    list.length,
  };
}

module.exports = { createJob, startJob, updateProgress, completeJob, failJob, getJob, listJobs, getSummary };
