"use strict";
/**
 * legalDocumentEngine.cjs — V6 Phase 6 (Category E: Legal OS)
 *
 * Real gap confirmed by search before writing this file: real, static
 * legal pages already exist (frontend/src/components/legal/ — ToS,
 * Privacy Policy, Cookie Policy, Refund Policy, Trust/Compliance — real
 * content, confirmed in an earlier session this same day). Real
 * compliance/policy/risk tracking already exists (governanceService.cjs —
 * 360 lines, real per-workspace policy/compliance/risk-matrix management).
 * capabilityContract.cjs is a false-positive name match — it's a software-
 * composition schema validator, unrelated to legal contracts. No document
 * GENERATION (contracts, DPAs, NDAs, custom terms) and no per-document
 * lifecycle (draft/review/signed/expired) existed anywhere — confirmed via
 * repo-wide search for termsOfService/contractGenerat/legalDocument/nda/
 * dpaGenerat patterns.
 *
 * This file adds real document generation, reusing:
 *   - aiService.cjs           — real AI generation (Groq-backed, confirmed
 *                                working this session), same extractJSON
 *                                helper used by every other AI-JSON
 *                                generator this session touched, so this
 *                                file inherits the maxTokens/control-
 *                                character fixes rather than repeating the
 *                                bugs those fixes closed
 *   - governanceService.cjs   — real compliance framework/risk data used
 *                                as generation context (e.g. a GDPR-aware
 *                                DPA references the workspace's actual
 *                                configured frameworks, not a guess)
 *   - continuousLearningEngine / runtimeEventBus — memory/telemetry
 *
 * Honest scope: generated documents are real, AI-drafted legal text
 * grounded in real workspace data — NOT reviewed by a lawyer, and this
 * file makes no claim of legal validity. Every generated document is
 * marked "draft" by default and the API requires an explicit
 * `acknowledgeNotLegalAdvice: true` flag to generate at all, so no
 * caller can accidentally treat AI output as vetted legal advice.
 *
 * Storage: data/legal-documents.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "legal-documents.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _ai  = () => _try(() => require("./aiService.js"));
const _gov = () => _try(() => require("./governanceService.cjs"));
const _bus = () => _try(() => require("../../agents/runtime/runtimeEventBus.cjs"));
const _le  = () => _try(() => require("./continuousLearningEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { documents: {}, stats: { generated: 0, byType: {} } }; }
}
function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}
function _emit(type, payload = {}) {
  try { _bus()?.emit(`legal_doc:${type}`, { ...payload, _source: "legalDocumentEngine", ts: _ts() }); } catch {}
}
function _learn(title, confidence, tags, data) {
  try { _le()?.createLesson?.({ type: "legal_document", title, source: "legalDocumentEngine", confidence, tags: ["legal", ...tags], data }); } catch {}
}

const DOCUMENT_TYPES = {
  nda:              { label: "Non-Disclosure Agreement", sections: ["Parties", "Definition of Confidential Information", "Obligations", "Term", "Exclusions", "Remedies", "Governing Law"] },
  dpa:              { label: "Data Processing Agreement", sections: ["Parties", "Scope of Processing", "Data Categories", "Processor Obligations", "Sub-processors", "Data Subject Rights", "Breach Notification", "Term & Termination"] },
  msa:              { label: "Master Service Agreement", sections: ["Parties", "Services", "Fees & Payment", "Term & Termination", "Confidentiality", "Warranties", "Limitation of Liability", "Governing Law"] },
  sow:              { label: "Statement of Work", sections: ["Project Overview", "Scope", "Deliverables", "Timeline", "Fees", "Acceptance Criteria"] },
  employment_offer: { label: "Employment Offer Letter", sections: ["Position", "Compensation", "Start Date", "At-Will Statement", "Confidentiality", "Contingencies"] },
  vendor_agreement: { label: "Vendor Agreement", sections: ["Parties", "Services/Goods", "Pricing", "Term", "Termination", "Liability", "Indemnification"] },
};

function listDocumentTypes() {
  return Object.entries(DOCUMENT_TYPES).map(([id, def]) => ({ id, label: def.label, sections: def.sections }));
}

function _buildPrompt(type, def, params, complianceContext) {
  const frameworks = complianceContext?.frameworks?.length ? complianceContext.frameworks.join(", ") : "none configured";
  return `You are drafting a ${def.label} for a real business. This is a DRAFT for legal review, not final legal advice.

Required sections: ${def.sections.join(", ")}

Parameters:
${Object.entries(params).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

Workspace compliance context (reference where relevant, especially in a DPA): configured frameworks = ${frameworks}.

Return JSON only, no markdown fences:
{
  "title": "string",
  "sections": [{ "heading": "string", "body": "string (real clause text, not a placeholder)" }],
  "summary": "one paragraph plain-English summary of what this document does"
}`;
}

async function generateDocument({ type, params = {}, workspaceId, acknowledgeNotLegalAdvice } = {}) {
  if (!acknowledgeNotLegalAdvice) {
    return { ok: false, error: "acknowledgeNotLegalAdvice:true required — generated documents are AI drafts, not reviewed legal advice" };
  }
  const def = DOCUMENT_TYPES[type];
  if (!def) return { ok: false, error: `unknown document type: ${type}. See listDocumentTypes().` };

  const ai = _ai();
  if (!ai) return { ok: false, error: "aiService unavailable" };

  let complianceContext = null;
  if (workspaceId) {
    const gov = _gov();
    try { complianceContext = gov?.getCompliance?.(workspaceId) || null; } catch { complianceContext = null; }
  }

  const prompt = _buildPrompt(type, def, params, complianceContext);
  let raw;
  try {
    raw = await ai.callAI(prompt, { maxTokens: 3000 });
  } catch (e) {
    return { ok: false, error: `AI generation failed: ${e.message}` };
  }

  const extracted = ai.extractJSON(raw);
  if (!extracted.ok) return { ok: false, error: extracted.error };
  const doc = extracted.data;
  if (!doc.sections || !Array.isArray(doc.sections)) return { ok: false, error: "AI response missing sections array" };

  const docId = _id("legaldoc");
  const record = {
    docId, type, typeLabel: def.label,
    title: doc.title || def.label,
    sections: doc.sections,
    summary: doc.summary || "",
    params,
    workspaceId: workspaceId || null,
    complianceFrameworksReferenced: complianceContext?.frameworks || [],
    status: "draft",
    notLegalAdvice: true,
    createdAt: _ts(),
    updatedAt: _ts(),
  };

  const d = _load();
  d.documents[docId] = record;
  d.stats.generated++;
  d.stats.byType[type] = (d.stats.byType[type] || 0) + 1;
  _save(d);

  _emit("generated", { docId, type });
  _learn(`Legal document drafted: ${def.label}`, 0.7, ["generated", type], { docId, type });

  return { ok: true, document: record };
}

function getDocument(docId) {
  const d = _load();
  return d.documents[docId] || null;
}

function listDocuments({ workspaceId, type, status, limit = 50 } = {}) {
  const d = _load();
  let docs = Object.values(d.documents);
  if (workspaceId) docs = docs.filter(x => x.workspaceId === workspaceId);
  if (type) docs = docs.filter(x => x.type === type);
  if (status) docs = docs.filter(x => x.status === status);
  return docs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
}

// Real, honest status lifecycle — no e-signature integration exists in
// this codebase (confirmed via search), so "signed" is a manual status
// transition the caller asserts after a real out-of-band signature
// process, not something this file verifies.
const STATUS_TRANSITIONS = { draft: ["under_review", "archived"], under_review: ["approved", "draft"], approved: ["signed", "draft"], signed: ["archived"], archived: [] };

function updateStatus(docId, newStatus, note = "") {
  const d = _load();
  const doc = d.documents[docId];
  if (!doc) return { ok: false, error: `document not found: ${docId}` };
  const allowed = STATUS_TRANSITIONS[doc.status] || [];
  if (!allowed.includes(newStatus)) return { ok: false, error: `cannot transition from ${doc.status} to ${newStatus}. Allowed: ${allowed.join(", ") || "none"}` };
  doc.status = newStatus;
  doc.updatedAt = _ts();
  doc.statusHistory = doc.statusHistory || [];
  doc.statusHistory.push({ status: newStatus, note, ts: _ts() });
  _save(d);
  _emit("status_changed", { docId, status: newStatus });
  return { ok: true, document: doc };
}

function getStats() { return _load().stats; }

module.exports = {
  listDocumentTypes, generateDocument, getDocument, listDocuments, updateStatus, getStats,
  DOCUMENT_TYPES,
};
