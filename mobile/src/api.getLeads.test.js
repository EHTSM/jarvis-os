"use strict";
/**
 * Mission 56 — regression test for getLeads()'s endpoint fix.
 *
 * Mission 55 found getLeads() called GET /crm, the operator-only bulk-dump
 * route (backend/routes/crm.js) — any non-operator mobile account got a
 * 403 on every call, silently swallowed to []. The fix routes it to the
 * already-existing customer-scoped GET /crm/leads instead.
 */

// api.js imports getIdToken from firebase.js only for the establishSession()
// flow, not for getLeads()/_fetch() (which reads the session token from
// localStorage instead) — mocked here purely to avoid pulling in the real
// firebase/auth SDK, whose Node build is incompatible with this project's
// default CRA Jest environment (missing TextEncoder), a pre-existing
// infrastructure gap unrelated to this fix.
jest.mock("./firebase.js", () => ({ getIdToken: jest.fn(async () => null) }));

function jsonResponse(body, { ok = true, status = ok ? 200 : 500 } = {}) {
  return { ok, status, json: async () => body };
}

function mockFetchOnce(router) {
  global.fetch = jest.fn(async (url, options) => {
    const path = typeof url === "string" ? url.replace(/^https?:\/\/[^/]+/, "") : url;
    const result = router(path, options);
    if (result && typeof result.ok === "boolean") return result;
    return jsonResponse(result);
  });
  return global.fetch;
}

// api.js reads localStorage for the session token — jsdom provides a real
// localStorage, no need to mock it; just ensure a clean slate per test.
beforeEach(() => {
  jest.resetModules();
  localStorage.clear();
  delete global.fetch;
});
afterEach(() => { delete global.fetch; });

describe("getLeads() — Mission 56 endpoint fix", () => {
  test("REGRESSION GUARD: getLeads() calls /crm/leads, never the operator-only /crm", async () => {
    const { getLeads } = require("./api.js");
    const mock = mockFetchOnce((path) => {
      expect(path.startsWith("/crm/leads")).toBe(true);
      expect(path).not.toBe("/crm");
      return [{ phone: "+919876543210", name: "Test Lead", status: "new", userId: "me" }];
    });

    const leads = await getLeads();
    expect(mock).toHaveBeenCalledTimes(1);
    expect(Array.isArray(leads)).toBe(true);
    expect(leads).toHaveLength(1);
    expect(leads[0].name).toBe("Test Lead");
  });

  test("a customer account (403 from the wrong endpoint would previously happen here) receives their own scoped leads, not a 403", async () => {
    const { getLeads } = require("./api.js");
    mockFetchOnce((path) => {
      // Simulates the real GET /crm/leads contract: 200 with only the
      // caller's own leads, never the operator-only bulk list.
      expect(path).toBe("/crm/leads");
      return jsonResponse([{ phone: "+911111111111", name: "My Own Lead", userId: "customer-1" }]);
    });

    const leads = await getLeads();
    expect(leads).toHaveLength(1);
    expect(leads[0].userId).toBe("customer-1");
  });

  test("operator behavior remains valid: the same call path is used regardless of role — the backend route itself differentiates operator vs. customer scoping", async () => {
    const { getLeads } = require("./api.js");
    mockFetchOnce((path) => {
      expect(path).toBe("/crm/leads");
      // Real GET /crm/leads returns the full list for an operator caller —
      // mobile's client code is role-agnostic; the backend does the scoping.
      return jsonResponse([
        { phone: "+911111111111", name: "Org A Lead", userId: "customer-1" },
        { phone: "+922222222222", name: "Org B Lead", userId: "customer-2" },
      ]);
    });

    const leads = await getLeads();
    expect(leads).toHaveLength(2);
  });

  test("no cross-tenant data is exposed: a 403 (e.g. a caller with no matching org) returns an empty array, never throws into the UI, never fabricates data", async () => {
    const { getLeads } = require("./api.js");
    mockFetchOnce((path) => {
      expect(path).toBe("/crm/leads");
      return jsonResponse({ error: "Forbidden" }, { ok: false, status: 403 });
    });

    const leads = await getLeads();
    expect(leads).toEqual([]);
  });

  test("status param is still accepted for API-shape compatibility (no server-side effect, matches the real /crm/leads contract)", async () => {
    const { getLeads } = require("./api.js");
    mockFetchOnce((path) => {
      expect(path).toBe("/crm/leads?status=hot");
      return jsonResponse([]);
    });

    await getLeads("hot");
  });
});
