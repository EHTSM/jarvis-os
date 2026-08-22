import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CommandCenter from "./CommandCenter";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

// CommandCenter's own emergency-stop flow is distinct from DevOpsCenterV2's
// (Mission 25's TabRuntime fix) — it's a second, independent call site for
// the same real /runtime/emergency/* endpoints, with its own custom
// confirmation overlay (not the shared useConfirm hook). Mounting the full
// default export pulls in ~7 concurrent API calls from its many sub-panels;
// all are stubbed to empty/successful so only the emergency-stop path under
// test is exercised meaningfully.
function silentRoutes(path) {
  if (path === "/runtime/approval-queue") return { queue: [] };
  if (path.startsWith("/runtime/history")) return { history: [] };
  if (path === "/runtime/exec/unified-queue") return { success: true, queue: [] };
  if (path === "/runtime/reliability/health-report") return { success: true };
  if (path === "/revenue/dashboard") return { ok: true, dashboard: { total: 0, deals: [] } };
  if (path === "/twin/dashboard") return { ok: true, dashboard: {} };
  if (path === "/vault/health") return { ok: true, connectors: [] };
  if (path === "/deployment/active") return { ok: true, deployments: [] };
  if (path === "/deployment/stats") return { ok: true, stats: {} };
  return { ok: true, success: true };
}

const BASE_PROPS = {
  stats: null, opsData: { emergencyStop: { active: false } }, online: true,
  onNavigate: () => {}, billing: null, onUpgrade: () => {}, onRefreshOps: () => {},
};

afterEach(() => restoreFetch());

describe("CommandCenter — Emergency Stop control (operator home dashboard)", () => {
  test("clicking the stop control opens a confirmation overlay before any network call fires", async () => {
    const mock = mockFetchRouter(silentRoutes);
    const user = userEvent.setup();
    render(<CommandCenter {...BASE_PROPS} />);
    const stopBtn = await screen.findByLabelText("Emergency stop");

    const callsBefore = mock.mock.calls.length;
    await user.click(stopBtn);
    expect(await screen.findByText("Stop All Execution")).toBeInTheDocument();
    expect(mock.mock.calls.some(([url]) => String(url).includes("/runtime/emergency/stop"))).toBe(false);
    expect(mock.mock.calls.length).toBeGreaterThanOrEqual(callsBefore);
  });

  test("cancelling the confirmation makes no network call and closes the overlay", async () => {
    const mock = mockFetchRouter(silentRoutes);
    const user = userEvent.setup();
    render(<CommandCenter {...BASE_PROPS} />);
    await user.click(await screen.findByLabelText("Emergency stop"));
    await screen.findByText("Stop All Execution");
    await user.click(screen.getByText("Cancel"));

    await waitFor(() => expect(screen.queryByText("Stop All Execution")).not.toBeInTheDocument());
    expect(mock.mock.calls.some(([url]) => String(url).includes("/runtime/emergency/stop"))).toBe(false);
  });

  test("confirming Stop All Execution calls the real endpoint and shows the emergency banner", async () => {
    let stopped = false;
    mockFetchRouter((path, options) => {
      if (path === "/runtime/emergency/stop" && options?.method === "POST") { stopped = true; return { success: true }; }
      return silentRoutes(path);
    });
    const user = userEvent.setup();
    render(<CommandCenter {...BASE_PROPS} />);
    await user.click(await screen.findByLabelText("Emergency stop"));
    await user.click(await screen.findByText("Stop All Execution"));

    await waitFor(() => expect(stopped).toBe(true));
    expect(await screen.findByText(/EMERGENCY STOP ACTIVE/)).toBeInTheDocument();
  });

  test("REGRESSION GUARD: a failed Stop call does NOT flip the UI into the emergency banner (no false success)", async () => {
    mockFetchRouter((path, options) => {
      if (path === "/runtime/emergency/stop" && options?.method === "POST") {
        return jsonResponse({ error: "Coordinator unreachable" }, { ok: false, status: 503 });
      }
      return silentRoutes(path);
    });
    const user = userEvent.setup();
    render(<CommandCenter {...BASE_PROPS} />);
    await user.click(await screen.findByLabelText("Emergency stop"));
    await user.click(await screen.findByText("Stop All Execution"));

    await waitFor(() => expect(screen.queryByText("Stop All Execution")).not.toBeInTheDocument());
    expect(screen.queryByText(/EMERGENCY STOP ACTIVE/)).not.toBeInTheDocument();
  });

  test("when already in emergency mode, the banner shows a Resume control instead of the stop button", async () => {
    mockFetchRouter(silentRoutes);
    render(<CommandCenter {...BASE_PROPS} opsData={{ emergencyStop: { active: true } }} />);
    expect(await screen.findByText(/EMERGENCY STOP ACTIVE/)).toBeInTheDocument();
    expect(screen.getByText("Resume →")).toBeInTheDocument();
    expect(screen.queryByLabelText("Emergency stop")).not.toBeInTheDocument();
  });

  test("Resume calls the real endpoint and clears the emergency banner", async () => {
    let resumed = false;
    mockFetchRouter((path, options) => {
      if (path === "/runtime/emergency/resume" && options?.method === "POST") { resumed = true; return { success: true }; }
      return silentRoutes(path);
    });
    const user = userEvent.setup();
    render(<CommandCenter {...BASE_PROPS} opsData={{ emergencyStop: { active: true } }} />);
    await screen.findByText(/EMERGENCY STOP ACTIVE/);
    await user.click(screen.getByText("Resume →"));

    await waitFor(() => expect(resumed).toBe(true));
    await waitFor(() => expect(screen.queryByText(/EMERGENCY STOP ACTIVE/)).not.toBeInTheDocument());
  });

  test("REGRESSION GUARD: a failed Resume does NOT clear the emergency banner (no false success)", async () => {
    mockFetchRouter((path, options) => {
      if (path === "/runtime/emergency/resume" && options?.method === "POST") {
        return jsonResponse({ error: "Coordinator busy" }, { ok: false, status: 503 });
      }
      return silentRoutes(path);
    });
    const user = userEvent.setup();
    render(<CommandCenter {...BASE_PROPS} opsData={{ emergencyStop: { active: true } }} />);
    await screen.findByText(/EMERGENCY STOP ACTIVE/);
    await user.click(screen.getByText("Resume →"));

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText(/EMERGENCY STOP ACTIVE/)).toBeInTheDocument();
  });
});
