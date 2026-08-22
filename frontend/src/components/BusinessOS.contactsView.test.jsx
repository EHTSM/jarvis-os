import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContactsView } from "./BusinessOS";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

const CONTACT = { id: "c1", name: "Priya Sharma", title: "CTO", company: "Acme", email: "p@x.com", opportunityIds: [] };

afterEach(() => restoreFetch());

describe("BusinessOS ContactsView — CRM contacts: search, create, edit, delete", () => {
  test("REGRESSION GUARD (P1 fix): an API failure shows a distinct error state — this view previously had NO error handling at all and showed a false 'No contacts yet' on any backend outage", async () => {
    mockFetchRouter(() => jsonResponse({ error: "Backend unreachable" }, { ok: false, status: 500 }));
    render(<ContactsView onToast={() => {}} />);
    expect(await screen.findByText("Couldn't load this data")).toBeInTheDocument();
    expect(screen.getByText("Backend unreachable")).toBeInTheDocument();
    expect(screen.queryByText("No contacts yet")).not.toBeInTheDocument();
  });

  test("Retry after a failed load recovers to real data", async () => {
    let attempt = 0;
    mockFetchRouter((path) => {
      if (!path.startsWith("/business/contacts")) return {};
      attempt += 1;
      if (attempt === 1) return jsonResponse({ error: "timeout" }, { ok: false, status: 504 });
      return { contacts: [CONTACT] };
    });
    const user = userEvent.setup();
    render(<ContactsView onToast={() => {}} />);
    await screen.findByText("Couldn't load this data");
    await user.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
  });

  test("genuinely empty account shows the empty state, not the error state", async () => {
    mockFetchRouter(() => ({ contacts: [] }));
    render(<ContactsView onToast={() => {}} />);
    expect(await screen.findByText("No contacts yet")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load this data")).not.toBeInTheDocument();
  });

  test("search re-fetches with the query as a search param (debounced)", async () => {
    const calls = [];
    mockFetchRouter((path) => {
      if (path.startsWith("/business/contacts")) { calls.push(path); return { contacts: [] }; }
      return {};
    });
    const user = userEvent.setup();
    render(<ContactsView onToast={() => {}} />);
    await screen.findByText("No contacts yet");
    await user.type(screen.getByPlaceholderText("Search by name, email, or company…"), "Priya");
    await waitFor(() => expect(calls.some(p => p.includes("search=Priya"))).toBe(true), { timeout: 2000 });
  });

  test("create: valid submit posts to /business/contacts and refreshes", async () => {
    let posted = null;
    mockFetchRouter((path, options) => {
      if (path === "/business/contacts" && options?.method === "POST") {
        posted = JSON.parse(options.body);
        return { success: true, contact: { ...CONTACT, id: "c2" } };
      }
      if (path.startsWith("/business/contacts")) return { contacts: posted ? [CONTACT] : [] };
      return {};
    });
    const onToast = jest.fn();
    const user = userEvent.setup();
    render(<ContactsView onToast={onToast} />);
    await screen.findByText("No contacts yet");
    await user.click(screen.getByText("+ New Contact"));
    await user.type(screen.getByPlaceholderText("Name *"), "New Contact");
    await user.click(screen.getByText("Create Contact"));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith("success", "Contact created"));
    expect(posted).toMatchObject({ name: "New Contact" });
  });

  test("destructive action: deleting a contact requires confirmation and cancelling makes no DELETE call", async () => {
    const mock = mockFetchRouter((path) => (path.startsWith("/business/contacts") ? { contacts: [CONTACT] } : {}));
    const user = userEvent.setup();
    render(<ContactsView onToast={() => {}} />);
    await screen.findByText("Priya Sharma");
    await user.click(screen.getByTitle("Delete"));
    const dialog = await screen.findByRole("dialog");
    const callsBefore = mock.mock.calls.length;
    await user.click(within(dialog).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mock.mock.calls.length).toBe(callsBefore);
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
  });

  test("destructive action: confirming delete calls DELETE and removes the contact", async () => {
    let deleted = false;
    mockFetchRouter((path, options) => {
      if (path === "/business/contacts/c1" && options?.method === "DELETE") { deleted = true; return { success: true }; }
      if (path.startsWith("/business/contacts")) return { contacts: deleted ? [] : [CONTACT] };
      return {};
    });
    const user = userEvent.setup();
    render(<ContactsView onToast={() => {}} />);
    await screen.findByText("Priya Sharma");
    await user.click(screen.getByTitle("Delete"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Delete"));
    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(screen.queryByText("Priya Sharma")).not.toBeInTheDocument());
  });
});
