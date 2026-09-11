import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LeadsView } from "./BusinessOS";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

const LEAD = { id: "l1", name: "Priya Sharma", email: "p@x.com", phone: "919876543210", company: "Acme", source: "inbound", score: 72, status: "new", createdAt: "2026-08-01T00:00:00Z" };
const QUALIFIED_LEAD = { ...LEAD, id: "l2", name: "Rahul Gupta", status: "qualified" };

afterEach(() => restoreFetch());

describe("BusinessOS LeadsView — CRM journey: discovery → create → edit → status → convert → delete", () => {
  test("loading state renders before data resolves", async () => {
    let resolveLeads;
    mockFetchRouter((path) => {
      if (path.startsWith("/business/leads")) return new Promise((res) => { resolveLeads = () => res(jsonResponse({ leads: [LEAD] })); });
      return {};
    });
    const { container } = render(<LeadsView onToast={() => {}} />);
    expect(container.querySelector(".bos-skeleton-wrap")).toBeInTheDocument();
    resolveLeads();
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
  });

  test("empty state renders when the filtered list has no leads (not confused with an error)", async () => {
    mockFetchRouter(() => ({ leads: [] }));
    render(<LeadsView onToast={() => {}} />);
    expect(await screen.findByText("No new leads")).toBeInTheDocument();
    expect(screen.getByText("Create your first lead above.")).toBeInTheDocument();
  });

  test("REGRESSION GUARD: an API failure shows a distinct error state, never silently falls through to the empty state", async () => {
    mockFetchRouter(() => jsonResponse({ error: "Backend unreachable" }, { ok: false, status: 500 }));
    render(<LeadsView onToast={() => {}} />);
    expect(await screen.findByText("Couldn't load this data")).toBeInTheDocument();
    expect(screen.getByText("Backend unreachable")).toBeInTheDocument();
    expect(screen.queryByText("No new leads")).not.toBeInTheDocument();
  });

  test("Retry after a failed load re-fetches and recovers to real data", async () => {
    let attempt = 0;
    mockFetchRouter((path) => {
      if (!path.startsWith("/business/leads")) return {};
      attempt += 1;
      if (attempt === 1) return jsonResponse({ error: "timeout" }, { ok: false, status: 504 });
      return { leads: [LEAD] };
    });
    const user = userEvent.setup();
    render(<LeadsView onToast={() => {}} />);
    await screen.findByText("Couldn't load this data");
    await user.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
  });

  test("real API contract: filter clicks re-fetch with the correct status query param", async () => {
    const calls = [];
    mockFetchRouter((path) => {
      if (path.startsWith("/business/leads")) { calls.push(path); return { leads: [] }; }
      return {};
    });
    const user = userEvent.setup();
    render(<LeadsView onToast={() => {}} />);
    await screen.findByText("No new leads");
    await user.click(screen.getByText("Qualified"));
    await waitFor(() => expect(calls.some(p => p.includes("status=qualified"))).toBe(true));
  });

  test("form validation: blocks Create with no network call when name is empty", async () => {
    const mock = mockFetchRouter((path) => (path.startsWith("/business/leads") ? { leads: [] } : {}));
    const user = userEvent.setup();
    render(<LeadsView onToast={() => {}} />);
    await screen.findByText("No new leads");
    await user.click(screen.getByText("+ New Lead"));
    const callsBefore = mock.mock.calls.length;
    await user.click(screen.getByText("Create Lead"));
    expect(mock.mock.calls.length).toBe(callsBefore); // no new POST fired
  });

  test("create: valid submit posts to /business/leads and refreshes the list", async () => {
    let posted = null;
    mockFetchRouter((path, options) => {
      if (path === "/business/leads" && options?.method === "POST") {
        posted = JSON.parse(options.body);
        return { success: true, lead: { ...LEAD, id: "l3" } };
      }
      if (path.startsWith("/business/leads")) return { leads: posted ? [LEAD, { ...LEAD, id: "l3", name: posted.name }] : [] };
      return {};
    });
    const onToast = jest.fn();
    const user = userEvent.setup();
    render(<LeadsView onToast={onToast} />);
    await screen.findByText("No new leads");
    await user.click(screen.getByText("+ New Lead"));
    await user.type(screen.getByPlaceholderText("Name *"), "New Prospect");
    await user.click(screen.getByText("Create Lead"));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith("success", "Lead created"));
    expect(posted).toMatchObject({ name: "New Prospect" });
  });

  test("REGRESSION GUARD: a failed create shows an error toast and preserves the typed form (form stays open)", async () => {
    mockFetchRouter((path, options) => {
      if (path === "/business/leads" && options?.method === "POST") {
        return jsonResponse({ error: "Server unavailable" }, { ok: false, status: 500 });
      }
      if (path.startsWith("/business/leads")) return { leads: [] };
      return {};
    });
    const onToast = jest.fn();
    const user = userEvent.setup();
    render(<LeadsView onToast={onToast} />);
    await screen.findByText("No new leads");
    await user.click(screen.getByText("+ New Lead"));
    await user.type(screen.getByPlaceholderText("Name *"), "New Prospect");
    await user.click(screen.getByText("Create Lead"));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith("error", "Server unavailable"));
    // form must still be open with the typed name intact — not silently discarded
    expect(screen.getByPlaceholderText("Name *").value).toBe("New Prospect");
  });

  test("duplicate-submit protection: Create button is disabled and shows a busy label mid-flight", async () => {
    let resolveFetch;
    mockFetchRouter((path, options) => {
      if (path === "/business/leads" && options?.method === "POST") {
        return new Promise((res) => { resolveFetch = () => res(jsonResponse({ success: true, lead: LEAD })); });
      }
      if (path.startsWith("/business/leads")) return { leads: [] };
      return {};
    });
    const user = userEvent.setup();
    render(<LeadsView onToast={() => {}} />);
    await screen.findByText("No new leads");
    await user.click(screen.getByText("+ New Lead"));
    await user.type(screen.getByPlaceholderText("Name *"), "New Prospect");
    await user.click(screen.getByText("Create Lead"));

    const busyBtn = screen.getByText("Saving…");
    expect(busyBtn).toBeDisabled();
    resolveFetch();
    await waitFor(() => expect(screen.queryByText("Saving…")).not.toBeInTheDocument());
  });

  test("status change: qualifying a new lead calls the qualify endpoint and refreshes", async () => {
    let qualified = false;
    mockFetchRouter((path, options) => {
      if (path === "/business/leads/l1/qualify" && options?.method === "POST") { qualified = true; return { success: true }; }
      if (path.startsWith("/business/leads")) return { leads: qualified ? [] : [LEAD] };
      return {};
    });
    const onToast = jest.fn();
    const user = userEvent.setup();
    render(<LeadsView onToast={onToast} />);
    await screen.findByText("Priya Sharma");
    await user.click(screen.getByTitle("Qualify"));
    await waitFor(() => expect(qualified).toBe(true));
    expect(onToast).toHaveBeenCalledWith("success", "Lead qualified");
  });

  test("convert: only offered for qualified leads, calls updateBizLead with status=converted", async () => {
    let patched = null;
    mockFetchRouter((path, options) => {
      if (path === "/business/leads/l2" && options?.method === "PATCH") { patched = JSON.parse(options.body); return { success: true }; }
      if (path.startsWith("/business/leads")) return { leads: [QUALIFIED_LEAD] };
      return {};
    });
    const onToast = jest.fn();
    const user = userEvent.setup();
    render(<LeadsView onToast={onToast} />);
    await screen.findByText("Rahul Gupta");
    expect(screen.queryByTitle("Qualify")).not.toBeInTheDocument(); // already qualified
    await user.click(screen.getByTitle("Convert to Customer"));
    await waitFor(() => expect(patched).toMatchObject({ status: "converted" }));
    expect(onToast).toHaveBeenCalledWith("success", "Lead converted to customer");
  });

  test("destructive action: deleting a lead requires confirmation — cancelling makes no network call", async () => {
    const mock = mockFetchRouter((path) => (path.startsWith("/business/leads") ? { leads: [LEAD] } : {}));
    const user = userEvent.setup();
    render(<LeadsView onToast={() => {}} />);
    await screen.findByText("Priya Sharma");

    await user.click(screen.getByTitle("Delete"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();

    const callsBefore = mock.mock.calls.length;
    await user.click(within(dialog).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mock.mock.calls.length).toBe(callsBefore);
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
  });

  test("destructive action: confirming delete calls DELETE and removes the lead from the list", async () => {
    let deleted = false;
    mockFetchRouter((path, options) => {
      if (path === "/business/leads/l1" && options?.method === "DELETE") { deleted = true; return { success: true }; }
      if (path.startsWith("/business/leads")) return { leads: deleted ? [] : [LEAD] };
      return {};
    });
    const user = userEvent.setup();
    render(<LeadsView onToast={() => {}} />);
    await screen.findByText("Priya Sharma");

    await user.click(screen.getByTitle("Delete"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Delete"));

    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(screen.queryByText("Priya Sharma")).not.toBeInTheDocument());
  });

  test("edit: opening edit prefills the form with the lead's existing data", async () => {
    mockFetchRouter((path) => (path.startsWith("/business/leads") ? { leads: [LEAD] } : {}));
    const user = userEvent.setup();
    render(<LeadsView onToast={() => {}} />);
    await screen.findByText("Priya Sharma");
    await user.click(screen.getByTitle("Edit"));
    expect(screen.getByPlaceholderText("Name *").value).toBe("Priya Sharma");
    expect(screen.getByPlaceholderText("Company").value).toBe("Acme");
    expect(screen.getByText("Save Changes")).toBeInTheDocument();
  });
});
