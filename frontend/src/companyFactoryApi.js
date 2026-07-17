// Company Factory API — thin wrappers over existing backend endpoints.
// No new backend routes. Backend: backend/routes/companyFactory.js (/company-factory/*)

import { _fetch } from "./_client";

export async function getFactoryDashboard() {
  try { return await _fetch("/company-factory/dashboard"); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function getFactoryStats() {
  try { return await _fetch("/company-factory/stats"); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function createCompany({ idea, name, templateId, founder, skipApproval }) {
  try {
    return await _fetch("/company-factory/create", {
      method: "POST",
      body: JSON.stringify({ idea, name, templateId, founder, skipApproval }),
    });
  } catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function listRuns(params = {}) {
  const qs = new URLSearchParams(params).toString();
  try { return await _fetch(`/company-factory/runs${qs ? `?${qs}` : ""}`); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function listTemplates() {
  try { return await _fetch("/company-factory/templates"); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function inferTemplate(description) {
  try {
    return await _fetch("/company-factory/templates/infer", {
      method: "POST",
      body: JSON.stringify({ description }),
    });
  } catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function listCompanies(params = {}) {
  const qs = new URLSearchParams(params).toString();
  try { return await _fetch(`/company-factory/companies${qs ? `?${qs}` : ""}`); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function getCompanyDetail(id) {
  try { return await _fetch(`/company-factory/companies/${encodeURIComponent(id)}/detail`); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function advanceCompanyStage(id, force = false) {
  try {
    return await _fetch(`/company-factory/companies/${encodeURIComponent(id)}/advance`, {
      method: "POST",
      body: JSON.stringify({ force }),
    });
  } catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function passCompanyGate(id, gate, evidence) {
  try {
    return await _fetch(`/company-factory/companies/${encodeURIComponent(id)}/gate`, {
      method: "POST",
      body: JSON.stringify({ gate, evidence }),
    });
  } catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function updateCompanyKPIs(id, kpis) {
  try {
    return await _fetch(`/company-factory/companies/${encodeURIComponent(id)}/kpis`, {
      method: "PATCH",
      body: JSON.stringify(kpis),
    });
  } catch (err) { return { ok: false, error: err.message, status: err.status }; }
}

export async function getLifecycleStages() {
  try { return await _fetch("/company-factory/lifecycle/stages"); }
  catch (err) { return { ok: false, error: err.message, status: err.status }; }
}
