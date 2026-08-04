"use strict";
// Pre-Burn-In Certification: /legal/* client — legalDocumentEngine.cjs was
// fully built (V6 Phase 6, Legal OS) with zero frontend consumers.
import { _fetch } from "./_client";

export async function listDocumentTypes() {
  return _fetch("/legal/document-types");
}

export async function generateDocument({ type, params, workspaceId }) {
  return _fetch("/legal/documents/generate", {
    method: "POST",
    body: JSON.stringify({ type, params, workspaceId, acknowledgeNotLegalAdvice: true }),
  });
}

export async function listDocuments({ workspaceId, type, status, limit = 50 } = {}) {
  const q = new URLSearchParams();
  if (workspaceId) q.set("workspaceId", workspaceId);
  if (type) q.set("type", type);
  if (status) q.set("status", status);
  q.set("limit", limit);
  return _fetch(`/legal/documents?${q.toString()}`);
}

export async function getDocument(docId) {
  return _fetch(`/legal/documents/${encodeURIComponent(docId)}`);
}

export async function updateStatus(docId, status, note) {
  return _fetch(`/legal/documents/${encodeURIComponent(docId)}/status`, {
    method: "POST",
    body: JSON.stringify({ status, note }),
  });
}

export async function getStats() {
  return _fetch("/legal/stats");
}
