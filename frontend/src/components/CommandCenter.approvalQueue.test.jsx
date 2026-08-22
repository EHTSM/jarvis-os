import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApprovalQueue } from "./CommandCenter";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

const ITEM = { id: "a1", itemId: "a1", priority: "high", description: "Deploy hotfix to production", queueType: "patch" };

afterEach(() => restoreFetch());

describe("CommandCenter ApprovalQueue — operator risk-approval gate", () => {
  test("loading state renders skeleton cards before data resolves", async () => {
    let resolveLoad;
    mockFetchRouter(() => new Promise((res) => { resolveLoad = () => res(jsonResponse({ queue: [ITEM] })); }));
    const { container } = render(<ApprovalQueue onNavigate={() => {}} />);
    expect(container.querySelectorAll(".skeleton--card").length).toBeGreaterThan(0);
    resolveLoad();
    await waitFor(() => expect(screen.getByText("Deploy hotfix to production")).toBeInTheDocument());
  });

  test("genuinely empty queue shows 'Queue clear', not an error", async () => {
    mockFetchRouter(() => ({ queue: [] }));
    render(<ApprovalQueue onNavigate={() => {}} />);
    expect(await screen.findByText("Queue clear — all decisions resolved")).toBeInTheDocument();
  });

  test("real data renders pending approval cards with priority and risk", async () => {
    mockFetchRouter(() => ({ queue: [{ ...ITEM, riskScore: 0.82 }] }));
    render(<ApprovalQueue onNavigate={() => {}} />);
    expect(await screen.findByText("Deploy hotfix to production")).toBeInTheDocument();
    expect(screen.getByText("HIGH")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
  });

  test("REGRESSION GUARD (P1 fix): an API failure shows a distinct error state with Retry, never a false 'queue clear'", async () => {
    mockFetchRouter(() => jsonResponse({ error: "Backend unreachable" }, { ok: false, status: 500 }));
    render(<ApprovalQueue onNavigate={() => {}} />);
    expect(await screen.findByText(/Couldn.t load this data — Backend unreachable/)).toBeInTheDocument();
    expect(screen.queryByText("Queue clear — all decisions resolved")).not.toBeInTheDocument();
  });

  test("Retry after a failed load recovers to real data", async () => {
    let attempt = 0;
    mockFetchRouter(() => {
      attempt += 1;
      return attempt === 1 ? jsonResponse({ error: "timeout" }, { ok: false, status: 504 }) : { queue: [ITEM] };
    });
    const user = userEvent.setup();
    render(<ApprovalQueue onNavigate={() => {}} />);
    await screen.findByText(/Couldn.t load this data/);
    await user.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByText("Deploy hotfix to production")).toBeInTheDocument());
  });

  test("Approve calls the real decide endpoint with decision=approve and the correct queueType", async () => {
    let posted = null;
    mockFetchRouter((path, options) => {
      if (path === "/runtime/approval-queue/a1/decide" && options?.method === "POST") {
        posted = JSON.parse(options.body);
        return { success: true };
      }
      return { queue: [ITEM] };
    });
    const user = userEvent.setup();
    render(<ApprovalQueue onNavigate={() => {}} />);
    await screen.findByText("Deploy hotfix to production");
    await user.click(screen.getByText("✓ Approve"));
    await waitFor(() => expect(posted).toMatchObject({ decision: "approve", queueType: "patch" }));
  });

  test("Reject calls the real decide endpoint with decision=reject", async () => {
    let posted = null;
    mockFetchRouter((path, options) => {
      if (path === "/runtime/approval-queue/a1/decide" && options?.method === "POST") {
        posted = JSON.parse(options.body);
        return { success: true };
      }
      return { queue: [ITEM] };
    });
    const user = userEvent.setup();
    render(<ApprovalQueue onNavigate={() => {}} />);
    await screen.findByText("Deploy hotfix to production");
    await user.click(screen.getByText("✗ Reject"));
    await waitFor(() => expect(posted).toMatchObject({ decision: "reject" }));
  });

  test("duplicate-submit protection: both Approve and Reject are disabled while a decision is in flight", async () => {
    let resolveDecide;
    mockFetchRouter((path, options) => {
      if (path === "/runtime/approval-queue/a1/decide" && options?.method === "POST") {
        return new Promise((res) => { resolveDecide = () => res(jsonResponse({ success: true })); });
      }
      return { queue: [ITEM] };
    });
    const user = userEvent.setup();
    render(<ApprovalQueue onNavigate={() => {}} />);
    await screen.findByText("Deploy hotfix to production");
    await user.click(screen.getByText("✓ Approve"));

    expect(screen.getByText("…")).toBeDisabled();
    const rejectBtn = screen.getAllByRole("button").find(b => b.textContent.includes("Reject"));
    expect(rejectBtn).toBeDisabled();
    resolveDecide();
    await waitFor(() => expect(screen.queryByText("…")).not.toBeInTheDocument());
  });

  test("REGRESSION GUARD (P1 fix): a failed decision does NOT remove the item from the pending queue (no false success)", async () => {
    mockFetchRouter((path, options) => {
      if (path === "/runtime/approval-queue/a1/decide" && options?.method === "POST") {
        return jsonResponse({ error: "Item already resolved" }, { ok: false, status: 409 });
      }
      return { queue: [ITEM] };
    });
    const user = userEvent.setup();
    render(<ApprovalQueue onNavigate={() => {}} />);
    await screen.findByText("Deploy hotfix to production");
    await user.click(screen.getByText("✓ Approve"));

    // give the (incorrectly-optimistic, pre-fix) setDecided a moment to fire if it were going to
    await new Promise((r) => setTimeout(r, 850));
    expect(screen.getByText("Deploy hotfix to production")).toBeInTheDocument();
    expect(screen.queryByText("Queue clear — all decisions resolved")).not.toBeInTheDocument();
  });
});
