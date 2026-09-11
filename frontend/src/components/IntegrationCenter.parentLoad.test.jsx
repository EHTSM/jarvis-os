import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IntegrationCenter from "./IntegrationCenter";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

function silentSideRoutes(path) {
  if (path.startsWith("/vault/credential-types")) return { ok: true, types: [] };
  if (path.startsWith("/oauth/connections")) return { connections: [] };
  return {};
}

afterEach(() => restoreFetch());

describe("IntegrationCenter parent dashboard — backend load failure must never render a false empty grid", () => {
  test("a real backend outage on getVaultDashboard() shows a distinct error state, not '0 of N configured'", async () => {
    mockFetchRouter((path) => {
      if (path.startsWith("/vault/dashboard")) return jsonResponse({ error: "Internal Server Error" }, { ok: false, status: 500 });
      if (path.startsWith("/integrations")) return { connectors: [] };
      return silentSideRoutes(path);
    });
    render(<IntegrationCenter />);

    expect(await screen.findByText(/Couldn't load connector status/)).toBeInTheDocument();
    // REGRESSION GUARD (P1 fix): previously this exact scenario rendered
    // every known connector as "not configured" with no error message —
    // indistinguishable from a genuinely fresh account.
    expect(screen.queryByText(/of \d+ configured/)).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  test("Retry on the error state re-calls the dashboard endpoint", async () => {
    let calls = 0;
    mockFetchRouter((path) => {
      if (path.startsWith("/vault/dashboard")) {
        calls++;
        return calls === 1
          ? jsonResponse({ error: "Internal Server Error" }, { ok: false, status: 500 })
          : { connected: ["stripe"], missing: ["twilio"], health: { overdue: 0, expiring: 0 } };
      }
      if (path.startsWith("/integrations")) return { connectors: [] };
      return silentSideRoutes(path);
    });
    const user = userEvent.setup();
    render(<IntegrationCenter />);
    await screen.findByText(/Couldn't load connector status/);
    await user.click(screen.getByText("Retry"));

    await waitFor(() => expect(screen.queryByText(/Couldn't load connector status/)).not.toBeInTheDocument());
    expect(await screen.findByText(/of 2 configured/)).toBeInTheDocument();
  });

  test("a genuinely fresh account (real dashboard, zero connected) still shows the honest '0 of N configured' count", async () => {
    mockFetchRouter((path) => {
      if (path.startsWith("/vault/dashboard")) return { connected: [], missing: ["stripe", "twilio"], health: { overdue: 0, expiring: 0 } };
      if (path.startsWith("/integrations")) return { connectors: [] };
      return silentSideRoutes(path);
    });
    render(<IntegrationCenter />);

    expect(await screen.findByText(/of 2 configured/)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load connector status/)).not.toBeInTheDocument();
  });

  test("non-operator role (401/403) is treated as expected, not as an error state", async () => {
    mockFetchRouter((path) => {
      if (path.startsWith("/vault/dashboard")) return jsonResponse({ error: "Forbidden" }, { ok: false, status: 403 });
      if (path.startsWith("/integrations")) return { connectors: [] };
      return silentSideRoutes(path);
    });
    render(<IntegrationCenter />);

    await waitFor(() => expect(screen.queryByText("Loading connectors…")).not.toBeInTheDocument());
    expect(screen.queryByText(/Couldn't load connector status/)).not.toBeInTheDocument();
    expect(await screen.findByText(/Credential management requires operator access\./)).toBeInTheDocument();
  });
});
