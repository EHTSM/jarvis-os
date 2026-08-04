"use strict";
// V6 Phase 7: /customer-org/* client — POST-Ω Sprint P11's Autonomous
// Customer Organization backend (journey/health/success/support/automation)
// was fully built with zero frontend consumers.
import { _fetch } from "./_client";

export async function getDashboard() {
  return _fetch("/customer-org/dashboard");
}

export async function getCustomerView(customerId) {
  return _fetch(`/customer-org/dashboard/customer/${encodeURIComponent(customerId)}`);
}

export async function listHealthRecords({ risk, grade, limit = 50 } = {}) {
  const q = new URLSearchParams();
  if (risk) q.set("risk", risk);
  if (grade) q.set("grade", grade);
  q.set("limit", limit);
  return _fetch(`/customer-org/health?${q.toString()}`);
}

export async function listJourneys({ stage, churnRisk, limit = 50 } = {}) {
  const q = new URLSearchParams();
  if (stage) q.set("stage", stage);
  if (churnRisk) q.set("churnRisk", churnRisk);
  q.set("limit", limit);
  return _fetch(`/customer-org/journey?${q.toString()}`);
}

export async function listTickets({ customerId, status, severity, limit = 50 } = {}) {
  const q = new URLSearchParams();
  if (customerId) q.set("customerId", customerId);
  if (status) q.set("status", status);
  if (severity) q.set("severity", severity);
  q.set("limit", limit);
  return _fetch(`/customer-org/support/tickets?${q.toString()}`);
}

export async function resolveTicket(id, body = {}) {
  return _fetch(`/customer-org/support/ticket/${encodeURIComponent(id)}/resolve`, { method: "POST", body: JSON.stringify(body) });
}

export async function getSupportStats() {
  return _fetch("/customer-org/support/stats");
}
