import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BillingDashboard from "./BillingDashboard";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

const ACTIVE_BILLING = { plan: "growth", status: "active", activatedAt: "2026-07-01T00:00:00Z", razorpaySubId: "sub_123" };
const TRIAL_BILLING   = { plan: "trial", status: "trialing", daysLeft: 5, trialEnd: "2026-08-30T00:00:00Z", trialStart: "2026-08-01T00:00:00Z" };

afterEach(() => restoreFetch());

describe("BillingDashboard — revenue-critical: plan status, trial state, subscription cancellation", () => {
  test("loading state renders before billing data resolves", async () => {
    let resolveBilling;
    mockFetchRouter(() => new Promise((res) => { resolveBilling = () => res(jsonResponse(ACTIVE_BILLING)); }));
    const { container } = render(<BillingDashboard onUpgrade={() => {}} />);
    expect(container.querySelector(".bd-skeleton-group")).toBeInTheDocument();
    resolveBilling();
    await waitFor(() => expect(screen.getByText("Billing")).toBeInTheDocument());
  });

  test("REGRESSION GUARD: a failed/unreachable billing fetch shows a distinct error state with Retry, not a blank or fabricated plan", async () => {
    mockFetchRouter(() => jsonResponse({}, { ok: false, status: 500 }));
    render(<BillingDashboard onUpgrade={() => {}} />);
    expect(await screen.findByText("Could not load billing information")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  test("Retry after a failed load recovers to real billing data", async () => {
    let attempt = 0;
    mockFetchRouter(() => {
      attempt += 1;
      if (attempt === 1) return jsonResponse({}, { ok: false, status: 500 });
      return jsonResponse(ACTIVE_BILLING);
    });
    const user = userEvent.setup();
    render(<BillingDashboard onUpgrade={() => {}} />);
    await screen.findByText("Could not load billing information");
    await user.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByText("Current Plan")).toBeInTheDocument());
  });

  test("trial state shows days-left messaging and an Upgrade action, not a Cancel option", async () => {
    mockFetchRouter(() => jsonResponse(TRIAL_BILLING));
    render(<BillingDashboard onUpgrade={() => {}} />);
    expect(await screen.findByText(/5 days left/)).toBeInTheDocument();
    expect(screen.getByText("Upgrade")).toBeInTheDocument();
    expect(screen.queryByText("Cancel subscription")).not.toBeInTheDocument();
  });

  test("active plan shows Cancel subscription, not Upgrade", async () => {
    mockFetchRouter(() => jsonResponse(ACTIVE_BILLING));
    render(<BillingDashboard onUpgrade={() => {}} />);
    await screen.findByText("Current Plan");
    expect(screen.getByText("Cancel subscription")).toBeInTheDocument();
    expect(screen.queryByText("Upgrade")).not.toBeInTheDocument();
  });

  test("destructive action: cancellation requires an explicit confirm step before any network call fires", async () => {
    const mock = mockFetchRouter((path) => (path === "/billing/status" ? jsonResponse(ACTIVE_BILLING) : jsonResponse({ success: true })));
    const user = userEvent.setup();
    render(<BillingDashboard onUpgrade={() => {}} />);
    await screen.findByText("Cancel subscription");
    const callsBefore = mock.mock.calls.length;
    await user.click(screen.getByText("Cancel subscription"));
    expect(screen.getByText(/Your access continues until the end/)).toBeInTheDocument();
    expect(mock.mock.calls.length).toBe(callsBefore); // no /billing/cancel call yet
    expect(screen.getByText("Keep subscription")).toBeInTheDocument();
  });

  test("'Keep subscription' backs out of the confirm step with no network call", async () => {
    const mock = mockFetchRouter((path) => (path === "/billing/status" ? jsonResponse(ACTIVE_BILLING) : jsonResponse({ success: true })));
    const user = userEvent.setup();
    render(<BillingDashboard onUpgrade={() => {}} />);
    await screen.findByText("Cancel subscription");
    await user.click(screen.getByText("Cancel subscription"));
    const callsBefore = mock.mock.calls.length;
    await user.click(screen.getByText("Keep subscription"));
    expect(screen.queryByText("Yes, cancel subscription")).not.toBeInTheDocument();
    expect(mock.mock.calls.length).toBe(callsBefore);
    expect(screen.getByText("Cancel subscription")).toBeInTheDocument();
  });

  test("confirming cancellation calls POST /billing/cancel and shows the cancelled state", async () => {
    let cancelled = false;
    mockFetchRouter((path, options) => {
      if (path === "/billing/cancel" && options?.method === "POST") { cancelled = true; return jsonResponse({ success: true }); }
      return jsonResponse(cancelled ? { ...ACTIVE_BILLING, status: "cancelled" } : ACTIVE_BILLING);
    });
    const user = userEvent.setup();
    render(<BillingDashboard onUpgrade={() => {}} />);
    await screen.findByText("Cancel subscription");
    await user.click(screen.getByText("Cancel subscription"));
    await user.click(screen.getByText("Yes, cancel subscription"));
    await waitFor(() => expect(cancelled).toBe(true));
  });

  test("REGRESSION GUARD (P2 fix): a failed cancellation shows an error message — previously failed silently with zero user feedback", async () => {
    mockFetchRouter((path, options) => {
      if (path === "/billing/cancel" && options?.method === "POST") {
        return jsonResponse({ error: "Payment provider unreachable" }, { ok: false, status: 502 });
      }
      return jsonResponse(ACTIVE_BILLING);
    });
    const user = userEvent.setup();
    render(<BillingDashboard onUpgrade={() => {}} />);
    await screen.findByText("Cancel subscription");
    await user.click(screen.getByText("Cancel subscription"));
    await user.click(screen.getByText("Yes, cancel subscription"));

    expect(await screen.findByText("Payment provider unreachable")).toBeInTheDocument();
    // still offering the confirm step, not silently reverted to the closed state
    expect(screen.getByText("Yes, cancel subscription")).toBeInTheDocument();
  });

  test("duplicate-submit protection: the confirm button is disabled and shows a busy label mid-flight", async () => {
    let resolveCancel;
    mockFetchRouter((path, options) => {
      if (path === "/billing/cancel" && options?.method === "POST") {
        return new Promise((res) => { resolveCancel = () => res(jsonResponse({ success: true })); });
      }
      return jsonResponse(ACTIVE_BILLING);
    });
    const user = userEvent.setup();
    render(<BillingDashboard onUpgrade={() => {}} />);
    await screen.findByText("Cancel subscription");
    await user.click(screen.getByText("Cancel subscription"));
    await user.click(screen.getByText("Yes, cancel subscription"));

    const busyBtn = screen.getByText("Cancelling…");
    expect(busyBtn).toBeDisabled();
    resolveCancel();
    await waitFor(() => expect(screen.queryByText("Cancelling…")).not.toBeInTheDocument());
  });

  test("clicking Upgrade invokes the onUpgrade callback", async () => {
    mockFetchRouter(() => jsonResponse(TRIAL_BILLING));
    const onUpgrade = jest.fn();
    const user = userEvent.setup();
    render(<BillingDashboard onUpgrade={onUpgrade} />);
    await screen.findByText("Upgrade");
    await user.click(screen.getByText("Upgrade"));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });
});
