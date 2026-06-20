"use strict";
/**
 * Feedback Hub — bug reports, feature requests, roadmap voting.
 *
 * Storage: data/feedback.json
 */

const fs   = require("fs");
const path = require("path");

const STORE_FILE = path.join(__dirname, "../../data/feedback.json");

const TYPES = ["bug", "feature", "improvement", "question"];
const STATUS = ["open", "in_review", "planned", "in_progress", "shipped", "closed", "won't_fix"];

function _load() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); }
  catch { return { items: {}, votes: {} }; }
}
function _save(d) {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(d, null, 2));
  } catch { /* non-fatal */ }
}
function _id() { return `fb-${Date.now()}-${Math.random().toString(36).slice(2,5)}`; }

function submit(opts = {}) {
  const store = _load();
  const id    = _id();
  const item  = {
    id,
    type:       opts.type       || "feature",
    title:      opts.title      || "Untitled",
    body:       opts.body       || "",
    accountId:  opts.accountId  || null,
    status:     "open",
    votes:      0,
    screenshot: opts.screenshot || null,
    sessionRef: opts.sessionRef || null,
    tags:       opts.tags       || [],
    createdAt:  new Date().toISOString(),
    updatedAt:  new Date().toISOString(),
  };
  store.items[id] = item;
  _save(store);
  return item;
}

function vote(id, accountId) {
  const store = _load();
  if (!store.items[id]) return null;
  if (!store.votes[id]) store.votes[id] = [];
  if (!store.votes[id].includes(accountId)) {
    store.votes[id].push(accountId);
    store.items[id].votes = store.votes[id].length;
    store.items[id].updatedAt = new Date().toISOString();
  }
  _save(store);
  return store.items[id];
}

function updateStatus(id, status) {
  const store = _load();
  if (!store.items[id]) return null;
  store.items[id].status    = status;
  store.items[id].updatedAt = new Date().toISOString();
  _save(store);
  return store.items[id];
}

function list(opts = {}) {
  const store = _load();
  let   list  = Object.values(store.items);
  if (opts.type)   list = list.filter(i => i.type === opts.type);
  if (opts.status) list = list.filter(i => i.status === opts.status);
  if (opts.accountId) list = list.filter(i => i.accountId === opts.accountId);
  return list.sort((a, b) => b.votes - a.votes).slice(0, opts.limit || 50);
}

function getItem(id) { return _load().items[id] || null; }

function getRoadmap() {
  const store  = _load();
  const items  = Object.values(store.items);
  const roadmap = {};
  for (const s of STATUS) {
    roadmap[s] = items.filter(i => i.status === s).sort((a,b) => b.votes - a.votes).slice(0,10);
  }
  return roadmap;
}

function getStats() {
  const store = _load();
  const items = Object.values(store.items);
  const byType   = {};
  const byStatus = {};
  for (const i of items) {
    byType[i.type]     = (byType[i.type]     || 0) + 1;
    byStatus[i.status] = (byStatus[i.status] || 0) + 1;
  }
  return { total: items.length, byType, byStatus };
}

module.exports = { submit, vote, updateStatus, list, getItem, getRoadmap, getStats, TYPES, STATUS };
