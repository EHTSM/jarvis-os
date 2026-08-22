import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamDirectoryPanel } from "./WorkspaceSettingsK3";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

const MEMBER = { accountId: "a1", name: "Priya Sharma", email: "p@x.com", role: "member", status: "active", title: "Engineer" };
const DEPT = { id: "d1", name: "Engineering" };

function baseRoutes({ team = [MEMBER], depts = [DEPT] } = {}) {
  return (path) => {
    if (path === "/admin/team") return { team };
    if (path === "/admin/departments") return { departments: depts };
    return {};
  };
}

afterEach(() => restoreFetch());

describe("WorkspaceSettingsK3 TeamDirectoryPanel — team/workspace changes (real org roster)", () => {
  test("real data renders the team roster", async () => {
    mockFetchRouter(baseRoutes());
    render(<TeamDirectoryPanel />);
    expect(await screen.findByText("Priya Sharma")).toBeInTheDocument();
  });

  test("genuinely empty team shows the empty state", async () => {
    mockFetchRouter(baseRoutes({ team: [] }));
    render(<TeamDirectoryPanel />);
    expect(await screen.findByText("No members match the current filter.")).toBeInTheDocument();
  });

  test("REGRESSION GUARD (P1 fix): an API failure shows a distinct error state with Retry, never a false empty roster", async () => {
    mockFetchRouter(() => jsonResponse({ error: "Backend unreachable" }, { ok: false, status: 500 }));
    render(<TeamDirectoryPanel />);
    expect(await screen.findByText(/Couldn.t load this data.*Backend unreachable/)).toBeInTheDocument();
    expect(screen.queryByText("No members match the current filter.")).not.toBeInTheDocument();
  });

  test("Retry after a failed load recovers to the real roster", async () => {
    let attempt = 0;
    mockFetchRouter((path) => {
      if (path === "/admin/team") {
        attempt += 1;
        return attempt === 1 ? jsonResponse({ error: "timeout" }, { ok: false, status: 504 }) : { team: [MEMBER] };
      }
      return baseRoutes()(path);
    });
    const user = userEvent.setup();
    render(<TeamDirectoryPanel />);
    await screen.findByText("Retry");
    await user.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
  });

  test("search filters by name/email", async () => {
    mockFetchRouter(baseRoutes({ team: [MEMBER, { ...MEMBER, accountId: "a2", name: "Rahul Gupta", email: "r@x.com" }] }));
    const user = userEvent.setup();
    render(<TeamDirectoryPanel />);
    await screen.findByText("Priya Sharma");
    await user.type(screen.getByPlaceholderText("Search name, email…"), "Rahul");
    expect(screen.queryByText("Priya Sharma")).not.toBeInTheDocument();
    expect(screen.getByText("Rahul Gupta")).toBeInTheDocument();
  });

  test("mutation: editing a member's title/department/status calls the real PATCH endpoint", async () => {
    let patched = null;
    mockFetchRouter((path, options) => {
      if (path === "/admin/member/a1" && options?.method === "PATCH") {
        patched = JSON.parse(options.body);
        return { success: true };
      }
      return baseRoutes()(path);
    });
    const user = userEvent.setup();
    render(<TeamDirectoryPanel />);
    await screen.findByText("Priya Sharma");
    await user.click(screen.getByText("Edit"));
    const titleInput = screen.getByPlaceholderText("e.g. Senior Engineer");
    await user.clear(titleInput);
    await user.type(titleInput, "Staff Engineer");
    await user.click(screen.getByText("Save"));

    await waitFor(() => expect(patched).toMatchObject({ title: "Staff Engineer" }));
  });

  test("REGRESSION GUARD: a failed member edit shows an error toast and does not silently succeed", async () => {
    mockFetchRouter((path, options) => {
      if (path === "/admin/member/a1" && options?.method === "PATCH") {
        return jsonResponse({ error: "Not authorized" }, { ok: false, status: 403 });
      }
      return baseRoutes()(path);
    });
    const user = userEvent.setup();
    render(<TeamDirectoryPanel />);
    await screen.findByText("Priya Sharma");
    await user.click(screen.getByText("Edit"));
    await user.click(screen.getByText("Save"));

    expect(await screen.findByText("Not authorized")).toBeInTheDocument();
  });

  test("bulk edit: applying a status change to selected members calls the real bulk endpoint", async () => {
    let posted = null;
    mockFetchRouter((path, options) => {
      if (path === "/admin/member/bulk" && options?.method === "POST") {
        posted = JSON.parse(options.body);
        return { applied: 1 };
      }
      return baseRoutes()(path);
    });
    const user = userEvent.setup();
    render(<TeamDirectoryPanel />);
    await screen.findByText("Priya Sharma");
    await user.click(screen.getByText("Bulk edit"));
    await user.click(screen.getByRole("checkbox"));
    const statusSelects = screen.getAllByRole("combobox").filter(s => within(s).queryByText("Choose…"));
    await user.selectOptions(statusSelects[0], "suspended");
    await user.click(screen.getByText("Apply"));

    await waitFor(() => expect(posted).toMatchObject({ accountIds: ["a1"], action: "set_status", payload: { status: "suspended" } }));
  });
});
