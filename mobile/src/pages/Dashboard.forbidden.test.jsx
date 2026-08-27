"use strict";
/**
 * Mission 56 — regression test: a 403 from operator-only /stats or /ops
 * must render a distinct authorization-error state, never the "No clients
 * yet" empty state a genuinely fresh account sees.
 *
 * Uses only react-dom + react-dom/test-utils (already real dependencies of
 * this package) rather than @testing-library/react, which is not installed
 * in mobile/ (only frontend/ has it) — per this mission's "no packages"
 * constraint, no new dependency was added.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import Dashboard from "./Dashboard.jsx";

jest.mock("../firebase.js", () => ({ getIdToken: jest.fn(async () => null) }));

// eslint-disable-next-line no-undef
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function jsonResponse(body, { ok = true, status = ok ? 200 : 500 } = {}) {
  return { ok, status, json: async () => body };
}

function mockFetchRouter(router) {
  global.fetch = jest.fn(async (url) => {
    const path = typeof url === "string" ? url.replace(/^https?:\/\/[^/]+/, "") : url;
    const result = router(path);
    if (result && typeof result.ok === "boolean") return result;
    return jsonResponse(result);
  });
  return global.fetch;
}

let container;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  document.body.removeChild(container);
  container = null;
  delete global.fetch;
  jest.resetModules();
});

async function renderDashboard() {
  const root = createRoot(container);
  await act(async () => {
    root.render(<Dashboard />);
    // Flush the Promise.allSettled([getStats(), getOpsData()]) microtasks.
    await new Promise(r => setTimeout(r, 0));
  });
  return container;
}

describe("Dashboard (Insights) — authorization error must not render as an empty state", () => {
  test("REGRESSION GUARD: a 403 from /stats and /ops shows a permission error, not 'No clients yet'", async () => {
    mockFetchRouter((path) => {
      if (path === "/stats") return jsonResponse({ error: "Forbidden" }, { ok: false, status: 403 });
      if (path === "/ops")   return jsonResponse({ error: "Forbidden" }, { ok: false, status: 403 });
      return jsonResponse({});
    });

    const el = await renderDashboard();
    expect(el.textContent).toContain("Insights not available");
    expect(el.textContent).not.toContain("No clients yet");
    expect(el.textContent).not.toContain("Add your first lead to see stats here.");
  });

  test("a genuinely empty (but authorized) account still shows the real empty state, not the permission error", async () => {
    mockFetchRouter((path) => {
      if (path === "/stats") return jsonResponse({ success: true, total: 0, hot: 0, paid: 0, revenue: 0, conversionRate: "0%", onboarded: 0 });
      if (path === "/ops")   return jsonResponse({ success: true, automation: {} });
      return jsonResponse({});
    });

    const el = await renderDashboard();
    expect(el.textContent).toContain("No clients yet");
    expect(el.textContent).not.toContain("Insights not available");
  });

  test("legitimate same-account flow: an authorized account with real leads sees its real stats, not any error/empty state", async () => {
    mockFetchRouter((path) => {
      if (path === "/stats") return jsonResponse({ success: true, total: 5, hot: 2, paid: 1, revenue: 999, conversionRate: "20%", onboarded: 1 });
      if (path === "/ops")   return jsonResponse({ success: true, automation: {} });
      return jsonResponse({});
    });

    const el = await renderDashboard();
    expect(el.textContent).not.toContain("Insights not available");
    expect(el.textContent).not.toContain("No clients yet");
    expect(el.textContent).toContain("Clients");
  });
});
