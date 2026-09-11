import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TeamWorkspace from "./TeamWorkspace";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

const WORKSPACE = { id: "ws1", invitations: [] };
const OWNER   = { accountId: "a1", name: "Founder", email: "f@x.com", role: "Owner" };
const MEMBER  = { accountId: "a2", name: "Priya",   email: "p@x.com", role: "Operator" };

function routeBase({ members = [OWNER], activity = [], invitations = [] } = {}) {
  return (path, options) => {
    if (path === "/workspace") {
      return { workspaces: [{ ...WORKSPACE, invitations }], activeWorkspaceId: "ws1" };
    }
    if (path === "/workspace/ws1/members") return { members };
    if (path === "/workspace/activity?workspaceId=ws1") return { activity };
    return {};
  };
}

afterEach(() => restoreFetch());

describe("TeamWorkspace — critical production surface: team invites & member removal", () => {
  test("loading state renders before data resolves, then real member data replaces it", async () => {
    let resolveMembers;
    const membersGate = new Promise((res) => { resolveMembers = () => res(jsonResponse({ members: [OWNER, MEMBER] })); });
    mockFetchRouter((path) => {
      if (path === "/workspace") return { workspaces: [WORKSPACE], activeWorkspaceId: "ws1" };
      if (path === "/workspace/ws1/members") return membersGate;
      if (path === "/workspace/activity?workspaceId=ws1") return { activity: [] };
      return {};
    });
    render(<TeamWorkspace onNavigate={() => {}} />);
    expect(await screen.findByText("Loading members…")).toBeInTheDocument();
    resolveMembers();
    await waitFor(() => expect(screen.getByText("Priya")).toBeInTheDocument());
    expect(screen.queryByText("Loading members…")).not.toBeInTheDocument();
  });

  test("solo-member empty state: only member has no Remove button and shows the invite prompt", async () => {
    mockFetchRouter(routeBase({ members: [OWNER] }));
    render(<TeamWorkspace onNavigate={() => {}} />);
    await waitFor(() => expect(screen.getByText("Founder")).toBeInTheDocument());
    expect(screen.getByText("You're the only member")).toBeInTheDocument();
    expect(screen.queryByText("Remove")).not.toBeInTheDocument();
  });

  test("Owner role cannot be removed even when other members exist", async () => {
    mockFetchRouter(routeBase({ members: [OWNER, MEMBER] }));
    render(<TeamWorkspace onNavigate={() => {}} />);
    await waitFor(() => expect(screen.getByText("Priya")).toBeInTheDocument());
    // Only one Remove button should exist — for the non-Owner member.
    expect(screen.getAllByText("Remove")).toHaveLength(1);
  });

  test("REGRESSION GUARD: a failed load shows an honest '—' placeholder, never a false '0'", async () => {
    mockFetchRouter(() => jsonResponse({ error: "timeout" }, { ok: false, status: 504 }));
    render(<TeamWorkspace onNavigate={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Couldn't load team data/)).toBeInTheDocument());
    const summaryValues = screen.getAllByText("—");
    expect(summaryValues.length).toBeGreaterThanOrEqual(4); // Members/Pending/Roles/Workspaces tiles
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  test("Retry after a failed load re-fetches and recovers to real data", async () => {
    let attempt = 0;
    mockFetchRouter((path) => {
      if (path === "/workspace") {
        attempt += 1;
        if (attempt === 1) return jsonResponse({ error: "timeout" }, { ok: false, status: 504 });
        return { workspaces: [WORKSPACE], activeWorkspaceId: "ws1" };
      }
      if (path === "/workspace/ws1/members") return { members: [OWNER] };
      if (path === "/workspace/activity?workspaceId=ws1") return { activity: [] };
      return {};
    });
    const user = userEvent.setup();
    render(<TeamWorkspace onNavigate={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Couldn't load team data/)).toBeInTheDocument());
    await user.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByText("Founder")).toBeInTheDocument());
  });

  test("removing a member requires confirmation — cancelling leaves the member in the list", async () => {
    const mock = mockFetchRouter(routeBase({ members: [OWNER, MEMBER] }));
    const user = userEvent.setup();
    render(<TeamWorkspace onNavigate={() => {}} />);
    await waitFor(() => expect(screen.getByText("Priya")).toBeInTheDocument());

    await user.click(screen.getByText("Remove"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/immediately lose access/)).toBeInTheDocument();

    await user.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Priya")).toBeInTheDocument();
    expect(mock.mock.calls.some(([url]) => String(url).includes("/members/a2"))).toBe(false);
  });

  test("removing a member: confirming calls DELETE and removes them from the list", async () => {
    let deleted = false;
    mockFetchRouter((path, options) => {
      if (path === "/workspace/ws1/members/a2" && options?.method === "DELETE") { deleted = true; return { success: true }; }
      return routeBase({ members: [OWNER, MEMBER] })(path, options);
    });
    const user = userEvent.setup();
    render(<TeamWorkspace onNavigate={() => {}} />);
    await waitFor(() => expect(screen.getByText("Priya")).toBeInTheDocument());

    await user.click(screen.getByText("Remove"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Remove"));

    await waitFor(() => expect(screen.queryByText("Priya")).not.toBeInTheDocument());
    expect(deleted).toBe(true);
  });

  test("inviting a member whose email fails to send is disclosed honestly, not shown as a plain success", async () => {
    mockFetchRouter((path, options) => {
      if (path === "/workspace/invite" && options?.method === "POST") {
        return { success: true, emailSent: false, emailError: "No provider configured" };
      }
      return routeBase({ members: [OWNER] })(path, options);
    });
    const user = userEvent.setup();
    render(<TeamWorkspace onNavigate={() => {}} />);
    await waitFor(() => expect(screen.getByText("Founder")).toBeInTheDocument());

    await user.click(screen.getByText("+ Invite member"));
    await user.type(screen.getByRole("textbox"), "new@x.com");
    await user.click(screen.getByText("Send invite →"));

    await waitFor(() => expect(screen.getByText(/could not be sent: No provider configured/)).toBeInTheDocument());
  });

  test("duplicate-submit protection: invite button shows a busy state and cannot be clicked twice", async () => {
    let resolveInvite;
    mockFetchRouter((path, options) => {
      if (path === "/workspace/invite" && options?.method === "POST") {
        return new Promise((res) => { resolveInvite = () => res(jsonResponse({ success: true, emailSent: true })); });
      }
      return routeBase({ members: [OWNER] })(path, options);
    });
    const user = userEvent.setup();
    render(<TeamWorkspace onNavigate={() => {}} />);
    await waitFor(() => expect(screen.getByText("Founder")).toBeInTheDocument());

    await user.click(screen.getByText("+ Invite member"));
    await user.type(screen.getByRole("textbox"), "new@x.com");
    await user.click(screen.getByText("Send invite →"));

    const busyBtn = screen.getByText("Sending…");
    expect(busyBtn).toBeDisabled();
    resolveInvite();
    await waitFor(() => expect(screen.queryByText("Sending…")).not.toBeInTheDocument());
  });
});
