// Business OS API — connects businessOS.cjs routes.
// All endpoints require operator session (JWT cookie via credentials: "include").
import { _fetch } from "./_client";

// ── Leads ─────────────────────────────────────────────────────────

export async function getLeadsV5({ status, source, assignee, minScore, limit = 50 } = {}) {
  try {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (source) q.set("source", source);
    if (assignee) q.set("assignee", assignee);
    if (minScore) q.set("minScore", String(minScore));
    if (limit) q.set("limit", String(limit));
    const qs = q.toString();
    return await _fetch(`/business/leads${qs ? "?" + qs : ""}`);
  } catch (err) { return { success: false, error: err.message, leads: [] }; }
}

export async function createBizLead({ name, email, phone, company, source, score, assignee, tags, notes } = {}) {
  try {
    return await _fetch("/business/leads", {
      method: "POST",
      body: JSON.stringify({ name, email, phone, company, source, score, assignee, tags, notes }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function updateBizLead(leadId, patch = {}) {
  try {
    return await _fetch(`/business/leads/${leadId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function qualifyBizLead(leadId, opts = {}) {
  try {
    return await _fetch(`/business/leads/${leadId}/qualify`, {
      method: "POST",
      body: JSON.stringify(opts),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function disqualifyBizLead(leadId, reason = "") {
  try {
    return await _fetch(`/business/leads/${leadId}/disqualify`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function deleteBizLead(leadId) {
  try {
    return await _fetch(`/business/leads/${leadId}`, { method: "DELETE" });
  } catch (err) { return { success: false, error: err.message }; }
}

// ── Contacts ──────────────────────────────────────────────────────

export async function getContacts({ company, search, limit = 50 } = {}) {
  try {
    const q = new URLSearchParams();
    if (company) q.set("company", company);
    if (search) q.set("search", search);
    if (limit) q.set("limit", String(limit));
    const qs = q.toString();
    return await _fetch(`/business/contacts${qs ? "?" + qs : ""}`);
  } catch (err) { return { success: false, error: err.message, contacts: [] }; }
}

export async function createContact({ name, email, phone, company, title, tags, notes, leadId } = {}) {
  try {
    return await _fetch("/business/contacts", {
      method: "POST",
      body: JSON.stringify({ name, email, phone, company, title, tags, notes, leadId }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function updateContact(contactId, patch = {}) {
  try {
    return await _fetch(`/business/contacts/${contactId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function deleteContact(contactId) {
  try {
    return await _fetch(`/business/contacts/${contactId}`, { method: "DELETE" });
  } catch (err) { return { success: false, error: err.message }; }
}

// ── Opportunities ─────────────────────────────────────────────────

export async function getOpportunities({ stage, assignee, minValue, limit = 50 } = {}) {
  try {
    const q = new URLSearchParams();
    if (stage) q.set("stage", stage);
    if (assignee) q.set("assignee", assignee);
    if (minValue) q.set("minValue", String(minValue));
    if (limit) q.set("limit", String(limit));
    const qs = q.toString();
    return await _fetch(`/business/opportunities${qs ? "?" + qs : ""}`);
  } catch (err) { return { success: false, error: err.message, opportunities: [] }; }
}

export async function createOpportunity({ title, value, currency, stage, contactId, leadId, company, assignee, campaignId, tags, notes } = {}) {
  try {
    return await _fetch("/business/opportunities", {
      method: "POST",
      body: JSON.stringify({ title, value, currency, stage, contactId, leadId, company, assignee, campaignId, tags, notes }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function updateOpportunity(oppId, patch = {}) {
  try {
    return await _fetch(`/business/opportunities/${oppId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function advanceOppStage(oppId, stage) {
  try {
    return await _fetch(`/business/opportunities/${oppId}/advance`, {
      method: "POST",
      body: JSON.stringify({ stage }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function closeWon(oppId, opts = {}) {
  try {
    return await _fetch(`/business/opportunities/${oppId}/close-won`, {
      method: "POST",
      body: JSON.stringify(opts),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function closeLost(oppId, reason = "") {
  try {
    return await _fetch(`/business/opportunities/${oppId}/close-lost`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getPipelineSummary() {
  try {
    return await _fetch("/business/pipeline");
  } catch (err) { return { success: false, error: err.message }; }
}

// ── Campaigns ─────────────────────────────────────────────────────

export async function getCampaigns({ status, channel, limit = 20 } = {}) {
  try {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (channel) q.set("channel", channel);
    if (limit) q.set("limit", String(limit));
    const qs = q.toString();
    return await _fetch(`/business/campaigns${qs ? "?" + qs : ""}`);
  } catch (err) { return { success: false, error: err.message, campaigns: [] }; }
}

export async function createCampaign({ name, channel, budget, startDate, endDate, goals, tags, notes } = {}) {
  try {
    return await _fetch("/business/campaigns", {
      method: "POST",
      body: JSON.stringify({ name, channel, budget, startDate, endDate, goals, tags, notes }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function updateCampaign(campaignId, patch = {}) {
  try {
    return await _fetch(`/business/campaigns/${campaignId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function recordCampaignEvent(campaignId, { type, value = 1 } = {}) {
  try {
    return await _fetch(`/business/campaigns/${campaignId}/event`, {
      method: "POST",
      body: JSON.stringify({ type, value }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function completeCampaign(campaignId, opts = {}) {
  try {
    return await _fetch(`/business/campaigns/${campaignId}/complete`, {
      method: "POST",
      body: JSON.stringify(opts),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

// ── Revenue ───────────────────────────────────────────────────────

export async function getRevenue({ type, dateFrom, dateTo, oppId, limit = 50 } = {}) {
  try {
    const q = new URLSearchParams();
    if (type) q.set("type", type);
    if (dateFrom) q.set("dateFrom", dateFrom);
    if (dateTo) q.set("dateTo", dateTo);
    if (oppId) q.set("oppId", oppId);
    if (limit) q.set("limit", String(limit));
    const qs = q.toString();
    return await _fetch(`/business/revenue${qs ? "?" + qs : ""}`);
  } catch (err) { return { success: false, error: err.message, revenue: [] }; }
}

export async function recordRevenue({ amount, currency, type, source, description, contactId, oppId, campaignId, recordedAt } = {}) {
  try {
    return await _fetch("/business/revenue", {
      method: "POST",
      body: JSON.stringify({ amount, currency, type, source, description, contactId, oppId, campaignId, recordedAt }),
    });
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getRevenueStats({ dateFrom, dateTo, currency } = {}) {
  try {
    const q = new URLSearchParams();
    if (dateFrom) q.set("dateFrom", dateFrom);
    if (dateTo) q.set("dateTo", dateTo);
    if (currency) q.set("currency", currency);
    const qs = q.toString();
    return await _fetch(`/business/revenue/stats${qs ? "?" + qs : ""}`);
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getLeadById(leadId) {
  try {
    return await _fetch(`/business/leads/${leadId}`);
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getContactById(contactId) {
  try {
    return await _fetch(`/business/contacts/${contactId}`);
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getOpportunityById(oppId) {
  try {
    return await _fetch(`/business/opportunities/${oppId}`);
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getCampaignById(campaignId) {
  try {
    return await _fetch(`/business/campaigns/${campaignId}`);
  } catch (err) { return { success: false, error: err.message }; }
}

// ── Summaries & Search ────────────────────────────────────────────

export async function getBusinessDashboard() {
  try {
    return await _fetch("/business/dashboard");
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getBusinessDailySummary(date) {
  try {
    const q = date ? `?date=${date}` : "";
    return await _fetch(`/business/summary/daily${q}`);
  } catch (err) { return { success: false, error: err.message }; }
}

export async function getBusinessWeeklySummary(weekStart) {
  try {
    const q = weekStart ? `?weekStart=${weekStart}` : "";
    return await _fetch(`/business/summary/weekly${q}`);
  } catch (err) { return { success: false, error: err.message }; }
}

export async function searchBusiness(query, limit = 20) {
  try {
    return await _fetch(`/business/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  } catch (err) { return { success: false, error: err.message, results: [] }; }
}

export async function getBusinessStats() {
  try {
    return await _fetch("/business/stats");
  } catch (err) { return { success: false, error: err.message }; }
}
