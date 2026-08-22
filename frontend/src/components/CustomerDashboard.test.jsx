import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CustomerDashboard from "./CustomerDashboard";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

const DASHBOARD = { dashboard: { leads: { total: 5, new: 2 }, opportunities: { total: 3, open: 2, wonThisMonth: 1, pipelineValue: 50000 }, revenue: { count: 1, total: 20000 } } };
const ORG_CTX = { primaryOrg: { orgName: "Acme Inc", orgRole: "org_admin", teams: [{ id: "t1" }] } };
const ACCOUNT = { account: { name: "Priya Sharma" } };
const BILLING = { success: true, plan: "growth", usage: { used: 40, limit: 100 } };

function baseRoutes({ dashboard = DASHBOARD, org = ORG_CTX, account = ACCOUNT, billing = BILLING } = {}) {
  return (path) => {
    if (path === "/billing/status") return billing;
    if (path === "/business/dashboard") return dashboard;
    if (path === "/orgs/me/context") return org;
    if (path === "/accounts/me") return account;
    return {};
  };
}

afterEach(() => restoreFetch());

describe("CustomerDashboard — critical production surface: home for role:user accounts", () => {
  test("loading state renders before data resolves", async () => {
    const resolvers = [];
    const routes = baseRoutes();
    mockFetchRouter((path) => new Promise((res) => { resolvers.push(() => res(jsonResponse(routes(path)))); }));
    render(<CustomerDashboard onNavigate={() => {}} />);
    expect(screen.getByText("Loading your dashboard…")).toBeInTheDocument();
    await act(async () => { resolvers.forEach((r) => r()); await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => expect(screen.queryByText("Loading your dashboard…")).not.toBeInTheDocument());
  });

  test("personalizes the greeting with the account's first name", async () => {
    mockFetchRouter(baseRoutes());
    render(<CustomerDashboard onNavigate={() => {}} />);
    expect(await screen.findByText("Welcome back, Priya")).toBeInTheDocument();
  });

  test("falls back to a generic greeting when the account name is unavailable", async () => {
    mockFetchRouter(baseRoutes({ account: { account: {} } }));
    render(<CustomerDashboard onNavigate={() => {}} />);
    expect(await screen.findByText("Welcome back")).toBeInTheDocument();
  });

  test("pipeline panel: real data renders stats, not a fabricated zero state", async () => {
    mockFetchRouter(baseRoutes());
    render(<CustomerDashboard onNavigate={() => {}} />);
    await screen.findByText("Your pipeline");
    expect(screen.getByText("5")).toBeInTheDocument(); // leads total
    expect(screen.getByText("2 new")).toBeInTheDocument();
    expect(screen.queryByText("No leads or deals yet")).not.toBeInTheDocument();
  });

  test("pipeline panel: genuinely empty account shows the empty state with a CRM CTA", async () => {
    mockFetchRouter(baseRoutes({ dashboard: { dashboard: { leads: { total: 0, new: 0 }, opportunities: { total: 0, open: 0, wonThisMonth: 0, pipelineValue: 0 }, revenue: { count: 0, total: 0 } } } }));
    render(<CustomerDashboard onNavigate={() => {}} />);
    expect(await screen.findByText("No leads or deals yet")).toBeInTheDocument();
    expect(screen.getByText("Go to CRM →")).toBeInTheDocument();
  });

  test("REGRESSION GUARD: a failed pipeline fetch shows a distinct error state, never a false empty state", async () => {
    mockFetchRouter((path) => (path === "/business/dashboard" ? jsonResponse({ error: "Backend unreachable" }, { ok: false, status: 500 }) : baseRoutes()(path)));
    render(<CustomerDashboard onNavigate={() => {}} />);
    const pipelinePanel = (await screen.findByText("Your pipeline")).closest(".cd-panel");
    expect(pipelinePanel).toHaveTextContent("Couldn't load this data");
    expect(pipelinePanel).toHaveTextContent("Backend unreachable");
    expect(pipelinePanel).not.toHaveTextContent("No leads or deals yet");
  });

  test("REGRESSION GUARD: a failed org-context fetch shows a distinct error state, never a false 'no organization' state", async () => {
    mockFetchRouter((path) => (path === "/orgs/me/context" ? jsonResponse({ error: "Backend unreachable" }, { ok: false, status: 500 }) : baseRoutes()(path)));
    render(<CustomerDashboard onNavigate={() => {}} />);
    const orgPanel = (await screen.findByText("Your organization")).closest(".cd-panel");
    expect(orgPanel).toHaveTextContent("Couldn't load this data");
    expect(orgPanel).not.toHaveTextContent("No organization yet");
  });

  test("org panel: no organization yet (genuinely null, no error) shows the empty state with a create CTA", async () => {
    mockFetchRouter(baseRoutes({ org: { primaryOrg: null } }));
    render(<CustomerDashboard onNavigate={() => {}} />);
    expect(await screen.findByText("No organization yet")).toBeInTheDocument();
    expect(screen.getByText("Create one →")).toBeInTheDocument();
  });

  test("org panel: real org renders name, role, and team count", async () => {
    mockFetchRouter(baseRoutes());
    render(<CustomerDashboard onNavigate={() => {}} />);
    expect(await screen.findByText("Acme Inc")).toBeInTheDocument();
    expect(screen.getByText("org admin")).toBeInTheDocument();
    expect(screen.getByText("1 team")).toBeInTheDocument();
  });

  test("Retry on the pipeline panel re-fetches and recovers to real data", async () => {
    let attempt = 0;
    mockFetchRouter((path) => {
      if (path === "/business/dashboard") {
        attempt += 1;
        return attempt === 1 ? jsonResponse({ error: "timeout" }, { ok: false, status: 504 }) : DASHBOARD;
      }
      return baseRoutes()(path);
    });
    const user = userEvent.setup();
    render(<CustomerDashboard onNavigate={() => {}} />);
    const pipelinePanel = (await screen.findByText("Your pipeline")).closest(".cd-panel");
    expect(pipelinePanel).toHaveTextContent("Couldn't load this data");
    await user.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByText("5")).toBeInTheDocument());
  });

  test("tenant context: an 'org-switched' window event triggers a full re-fetch (no stale org/pipeline data after switching)", async () => {
    let orgCallCount = 0;
    mockFetchRouter((path) => {
      if (path === "/orgs/me/context") {
        orgCallCount += 1;
        return orgCallCount === 1 ? ORG_CTX : { primaryOrg: { orgName: "New Org Ltd", orgRole: "member", teams: [] } };
      }
      return baseRoutes()(path);
    });
    render(<CustomerDashboard onNavigate={() => {}} />);
    await screen.findByText("Acme Inc");

    await act(async () => { window.dispatchEvent(new Event("org-switched")); });
    await waitFor(() => expect(screen.getByText("New Org Ltd")).toBeInTheDocument());
  });

  test("quick actions navigate to the correct real tabs, including the AI Chat fix (chat, not jarvisbrain)", async () => {
    mockFetchRouter(baseRoutes());
    const onNavigate = jest.fn();
    const user = userEvent.setup();
    render(<CustomerDashboard onNavigate={onNavigate} />);
    await screen.findByText("Your pipeline");
    await user.click(screen.getByText("AI Chat"));
    expect(onNavigate).toHaveBeenCalledWith("chat");
  });

  test("billing usage chip renders plan and AI-action usage when present", async () => {
    mockFetchRouter(baseRoutes());
    render(<CustomerDashboard onNavigate={() => {}} />);
    expect(await screen.findByText("Growth")).toBeInTheDocument();
    expect(screen.getByText("40 / 100 AI actions this month")).toBeInTheDocument();
  });
});
