import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabDeployments } from "./DevOpsCenterV2";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

const FAILED_DEPLOY = {
  id: "d1", environment: "production", repo: "ooplix-backend", version: "v2.3.1",
  status: "failed", durationMs: 42000, triggeredBy: "Autopilot", startedAt: new Date().toISOString(), commit: "abc1234567",
};

function silentSideRoutes(path) {
  if (path === "/deployment/strategy/environments") return { environments: [] };
  if (path.startsWith("/deployment/strategy/runs")) return { runs: [] };
  return {};
}

afterEach(() => restoreFetch());

describe("DevOpsCenterV2 TabDeployments — deploy history + rollback (destructive operational control)", () => {
  test("real data replaces the sample notice once a real deployment list loads", async () => {
    mockFetchRouter((path) => {
      if (path.startsWith("/p25/deploy?")) return { deployments: [FAILED_DEPLOY] };
      if (path.startsWith("/p25/deploy/history")) return { history: [] };
      return silentSideRoutes(path);
    });
    render(<TabDeployments addToast={() => {}} />);
    expect(await screen.findByText("ooplix-backend")).toBeInTheDocument();
    expect(screen.queryByText(/sample deployment history/)).not.toBeInTheDocument();
  });

  test("no real deployments: sample notice stays visible (honestly disclosed, not silently hidden)", async () => {
    mockFetchRouter((path) => {
      if (path.startsWith("/p25/deploy?")) return { deployments: [] };
      if (path.startsWith("/p25/deploy/history")) return { history: [] };
      return silentSideRoutes(path);
    });
    render(<TabDeployments addToast={() => {}} />);
    expect(await screen.findByText(/sample deployment history/)).toBeInTheDocument();
  });

  test("REGRESSION GUARD (P1 fix): Rollback requires confirmation naming the real deployment before any network call fires", async () => {
    const mock = mockFetchRouter((path) => {
      if (path.startsWith("/p25/deploy?")) return { deployments: [FAILED_DEPLOY] };
      if (path.startsWith("/p25/deploy/history")) return { history: [] };
      return silentSideRoutes(path);
    });
    const user = userEvent.setup();
    render(<TabDeployments addToast={() => {}} />);
    await user.click(await screen.findByText("ooplix-backend"));
    await user.click(screen.getByText("↩ Rollback"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/reverts the production deployment of ooplix-backend/)).toBeInTheDocument();
    expect(mock.mock.calls.some(([url]) => String(url).includes("/rollback"))).toBe(false);
  });

  test("cancelling the rollback confirmation makes no network call", async () => {
    const mock = mockFetchRouter((path) => {
      if (path.startsWith("/p25/deploy?")) return { deployments: [FAILED_DEPLOY] };
      if (path.startsWith("/p25/deploy/history")) return { history: [] };
      return silentSideRoutes(path);
    });
    const user = userEvent.setup();
    render(<TabDeployments addToast={() => {}} />);
    await user.click(await screen.findByText("ooplix-backend"));
    await user.click(screen.getByText("↩ Rollback"));
    const dialog = await screen.findByRole("dialog");
    const callsBefore = mock.mock.calls.length;
    await user.click(within(dialog).getByText("Cancel"));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mock.mock.calls.length).toBe(callsBefore);
  });

  test("confirming rollback calls the real endpoint and shows a genuine success toast", async () => {
    let rolledBack = false;
    const onToast = jest.fn();
    mockFetchRouter((path, options) => {
      if (path === "/p25/deploy/d1/rollback" && options?.method === "POST") { rolledBack = true; return { success: true }; }
      if (path.startsWith("/p25/deploy?")) return { deployments: [FAILED_DEPLOY] };
      if (path.startsWith("/p25/deploy/history")) return { history: [] };
      return silentSideRoutes(path);
    });
    const user = userEvent.setup();
    render(<TabDeployments addToast={onToast} />);
    await user.click(await screen.findByText("ooplix-backend"));
    await user.click(screen.getByText("↩ Rollback"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Roll back"));

    await waitFor(() => expect(rolledBack).toBe(true));
    expect(onToast).toHaveBeenCalledWith("Rollback initiated for ooplix-backend", "success");
  });

  test("REGRESSION GUARD (P1 fix): a failed rollback shows the real error at error severity, not a misleading 'info'-level message", async () => {
    const onToast = jest.fn();
    mockFetchRouter((path, options) => {
      if (path === "/p25/deploy/d1/rollback" && options?.method === "POST") {
        return jsonResponse({ error: "Deployment not found" }, { ok: false, status: 404 });
      }
      if (path.startsWith("/p25/deploy?")) return { deployments: [FAILED_DEPLOY] };
      if (path.startsWith("/p25/deploy/history")) return { history: [] };
      return silentSideRoutes(path);
    });
    const user = userEvent.setup();
    render(<TabDeployments addToast={onToast} />);
    await user.click(await screen.findByText("ooplix-backend"));
    await user.click(screen.getByText("↩ Rollback"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Roll back"));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith("Rollback failed: Deployment not found", "error"));
    expect(onToast).not.toHaveBeenCalledWith("Rollback initiated for ooplix-backend", "success");
  });

  test("duplicate-submit protection: Rollback shows a busy label and is disabled mid-flight", async () => {
    let resolveRollback;
    mockFetchRouter((path, options) => {
      if (path === "/p25/deploy/d1/rollback" && options?.method === "POST") {
        return new Promise((res) => { resolveRollback = () => res(jsonResponse({ success: true })); });
      }
      if (path.startsWith("/p25/deploy?")) return { deployments: [FAILED_DEPLOY] };
      if (path.startsWith("/p25/deploy/history")) return { history: [] };
      return silentSideRoutes(path);
    });
    const user = userEvent.setup();
    render(<TabDeployments addToast={() => {}} />);
    await user.click(await screen.findByText("ooplix-backend"));
    await user.click(screen.getByText("↩ Rollback"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Roll back"));

    const busyBtn = screen.getByText("⟳ Rolling back…");
    expect(busyBtn).toBeDisabled();
    resolveRollback();
    await waitFor(() => expect(screen.queryByText("⟳ Rolling back…")).not.toBeInTheDocument());
  });

  test("only failed deployments offer a Rollback action", async () => {
    const successDeploy = { ...FAILED_DEPLOY, id: "d2", status: "success" };
    mockFetchRouter((path) => {
      if (path.startsWith("/p25/deploy?")) return { deployments: [successDeploy] };
      if (path.startsWith("/p25/deploy/history")) return { history: [] };
      return silentSideRoutes(path);
    });
    const user = userEvent.setup();
    render(<TabDeployments addToast={() => {}} />);
    await user.click(await screen.findByText("ooplix-backend"));
    expect(screen.queryByText("↩ Rollback")).not.toBeInTheDocument();
  });
});
