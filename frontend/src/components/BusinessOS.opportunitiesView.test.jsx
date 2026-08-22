import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpportunitiesView } from "./BusinessOS";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

const OPP = { id: "o1", title: "Website Redesign", value: 50000, currency: "USD", stage: "prospect", company: "Acme", assignee: "", createdAt: "2026-08-01T00:00:00Z" };

afterEach(() => restoreFetch());

describe("BusinessOS OpportunitiesView — revenue-critical pipeline: advance, close-won, close-lost", () => {
  test("REGRESSION GUARD: an API failure shows the distinct error state, never a false 'no deals' empty state", async () => {
    mockFetchRouter(() => jsonResponse({ error: "Backend unreachable" }, { ok: false, status: 500 }));
    render(<OpportunitiesView onToast={() => {}} />);
    expect(await screen.findByText("Couldn't load this data")).toBeInTheDocument();
    expect(screen.queryByText("No deals")).not.toBeInTheDocument();
  });

  test("real API contract: closing a deal as Won calls /business/opportunities/:id/close-won and refreshes", async () => {
    let closedWon = false;
    mockFetchRouter((path, options) => {
      if (path === "/business/opportunities/o1/close-won" && options?.method === "POST") { closedWon = true; return { success: true }; }
      if (path.startsWith("/business/opportunities")) return { opportunities: closedWon ? [] : [OPP] };
      return {};
    });
    const onToast = jest.fn();
    const user = userEvent.setup();
    render(<OpportunitiesView onToast={onToast} />);
    await screen.findByText("Website Redesign");
    await user.click(screen.getByText("Won ✓"));
    await waitFor(() => expect(closedWon).toBe(true));
    expect(onToast).toHaveBeenCalledWith("success", "Deal closed — won! 🎉");
  });

  test("real API contract: closing a deal as Lost calls /business/opportunities/:id/close-lost", async () => {
    let closedLost = false;
    mockFetchRouter((path, options) => {
      if (path === "/business/opportunities/o1/close-lost" && options?.method === "POST") { closedLost = true; return { success: true }; }
      if (path.startsWith("/business/opportunities")) return { opportunities: closedLost ? [] : [OPP] };
      return {};
    });
    const onToast = jest.fn();
    const user = userEvent.setup();
    render(<OpportunitiesView onToast={onToast} />);
    await screen.findByText("Website Redesign");
    await user.click(screen.getByText("Lost ✗"));
    await waitFor(() => expect(closedLost).toBe(true));
    expect(onToast).toHaveBeenCalledWith("success", "Deal marked closed-lost");
  });

  test("REGRESSION GUARD: a failed close-won shows an error toast, the deal is NOT removed from the open list", async () => {
    mockFetchRouter((path, options) => {
      if (path === "/business/opportunities/o1/close-won" && options?.method === "POST") {
        return jsonResponse({ error: "Deal already closed" }, { ok: false, status: 409 });
      }
      if (path.startsWith("/business/opportunities")) return { opportunities: [OPP] };
      return {};
    });
    const onToast = jest.fn();
    const user = userEvent.setup();
    render(<OpportunitiesView onToast={onToast} />);
    await screen.findByText("Website Redesign");
    await user.click(screen.getByText("Won ✓"));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("error", "Deal already closed"));
    expect(screen.getByText("Website Redesign")).toBeInTheDocument(); // still in the list
  });

  test("closed deals do not offer Advance/Won/Lost actions (no re-closing a closed deal)", async () => {
    const closedOpp = { ...OPP, stage: "closed-won" };
    mockFetchRouter((path) => (path.startsWith("/business/opportunities") ? { opportunities: [closedOpp] } : {}));
    render(<OpportunitiesView onToast={() => {}} />);
    await screen.findByText("Website Redesign");
    expect(screen.queryByText("Won ✓")).not.toBeInTheDocument();
    expect(screen.queryByText("Lost ✗")).not.toBeInTheDocument();
    expect(screen.queryByText("Advance →")).not.toBeInTheDocument();
  });

  test("advance stage: prospect deal advances to qualified via /advance", async () => {
    let advancedTo = null;
    mockFetchRouter((path, options) => {
      if (path === "/business/opportunities/o1/advance" && options?.method === "POST") {
        advancedTo = JSON.parse(options.body).stage;
        return { success: true };
      }
      if (path.startsWith("/business/opportunities")) return { opportunities: [OPP] };
      return {};
    });
    const user = userEvent.setup();
    render(<OpportunitiesView onToast={() => {}} />);
    await screen.findByText("Website Redesign");
    await user.click(screen.getByText("Advance →"));
    await waitFor(() => expect(advancedTo).toBe("qualified"));
  });

  test("form validation: blocks Create Deal with no network call when title is empty", async () => {
    const mock = mockFetchRouter((path) => (path.startsWith("/business/opportunities") ? { opportunities: [] } : {}));
    const user = userEvent.setup();
    render(<OpportunitiesView onToast={() => {}} />);
    await screen.findByText("No deals");
    await user.click(screen.getByText("+ New Deal"));
    const callsBefore = mock.mock.calls.length;
    await user.click(screen.getByText("Create Deal"));
    expect(mock.mock.calls.length).toBe(callsBefore);
  });

  test("REGRESSION GUARD: a failed deal creation preserves the typed title/value", async () => {
    mockFetchRouter((path, options) => {
      if (path === "/business/opportunities" && options?.method === "POST") {
        return jsonResponse({ error: "Server error" }, { ok: false, status: 500 });
      }
      if (path.startsWith("/business/opportunities")) return { opportunities: [] };
      return {};
    });
    const user = userEvent.setup();
    render(<OpportunitiesView onToast={() => {}} />);
    await screen.findByText("No deals");
    await user.click(screen.getByText("+ New Deal"));
    await user.type(screen.getByPlaceholderText("Deal title *"), "Big Contract");
    await user.type(screen.getByPlaceholderText("Value (amount)"), "100000");
    await user.click(screen.getByText("Create Deal"));

    await waitFor(() => expect(screen.getByPlaceholderText("Deal title *").value).toBe("Big Contract"));
    expect(screen.getByPlaceholderText("Value (amount)").value).toBe("100000");
  });
});
