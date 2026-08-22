import { generatePaymentLink } from "./paymentApi";
import { getBillingStatus, upgradeAccount } from "./authApi";
import { mockFetchRouter, restoreFetch, jsonResponse } from "./testUtils/mockFetch";

afterEach(() => restoreFetch());

describe("billing/payment UI flows (category 10)", () => {
  test("generatePaymentLink posts amount/name/phone/description and returns the link payload", async () => {
    const mock = mockFetchRouter((path, options) => {
      expect(path).toBe("/payment/link");
      expect(JSON.parse(options.body)).toEqual({
        amount: 4999, name: "Acme Inc", phone: "+15551234567", description: "Pro plan",
      });
      return { success: true, link: "https://pay.example/abc123" };
    });
    const result = await generatePaymentLink({ amount: 4999, name: "Acme Inc", phone: "+15551234567", description: "Pro plan" });
    expect(result).toMatchObject({ success: true, link: "https://pay.example/abc123" });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  test("generatePaymentLink never throws on a backend failure — returns a structured error instead", async () => {
    mockFetchRouter(() => jsonResponse({ error: "Razorpay unreachable" }, { ok: false, status: 502 }));
    const result = await generatePaymentLink({ amount: 100, name: "x", phone: "y", description: "z" });
    expect(result).toEqual({ success: false, error: "Razorpay unreachable" });
  });

  test("getBillingStatus surfaces the current plan/status from the backend", async () => {
    mockFetchRouter((path) => {
      expect(path).toBe("/billing/status");
      return { success: true, plan: "pro", status: "active", renewsAt: "2026-09-01" };
    });
    const result = await getBillingStatus();
    expect(result).toMatchObject({ plan: "pro", status: "active" });
  });

  test("getBillingStatus failure does not throw — UI can render an error state instead of crashing", async () => {
    mockFetchRouter(() => jsonResponse({ error: "unauthorized" }, { ok: false, status: 401 }));
    const result = await getBillingStatus();
    expect(result.success).toBe(false);
  });

  test("upgradeAccount posts the chosen plan", async () => {
    const mock = mockFetchRouter((path, options) => {
      expect(path).toBe("/billing/upgrade");
      expect(JSON.parse(options.body)).toEqual({ plan: "enterprise" });
      return { success: true };
    });
    const result = await upgradeAccount("enterprise");
    expect(result.success).toBe(true);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  test("upgradeAccount failure (e.g. declined payment) resolves to a structured error, not a throw", async () => {
    mockFetchRouter(() => jsonResponse({ error: "Card declined" }, { ok: false, status: 402 }));
    const result = await upgradeAccount("pro");
    expect(result).toEqual({ success: false, error: "Card declined" });
  });
});
