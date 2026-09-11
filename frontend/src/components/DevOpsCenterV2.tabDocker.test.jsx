import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabDocker } from "./DevOpsCenterV2";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

const RUNNING_CONTAINER = { ID: "c1", Names: "ooplix-worker", Image: "ooplix/worker:latest", State: "running", RunningFor: "3 hours" };
const DASHBOARD = { daemon: { reachable: true, serverVersion: "24.0" }, daemonStats: { containersRunning: 1, containersTotal: 1, imagesTotal: 3 }, containers: [RUNNING_CONTAINER] };

afterEach(() => restoreFetch());

describe("DevOpsCenterV2 TabDocker — container operations (real, disruptive infra controls)", () => {
  test("loading state renders before the dashboard resolves", async () => {
    let resolve;
    mockFetchRouter(() => new Promise((res) => { resolve = () => res(jsonResponse(DASHBOARD)); }));
    render(<TabDocker addToast={() => {}} />);
    expect(screen.getByText("Loading Docker status…")).toBeInTheDocument();
    resolve();
    await waitFor(() => expect(screen.getByText("ooplix-worker")).toBeInTheDocument());
  });

  test("REGRESSION-STYLE CHECK: a failed dashboard load shows a distinct error, never a fabricated empty container list", async () => {
    mockFetchRouter(() => jsonResponse({ error: "Docker daemon unreachable" }, { ok: false, status: 500 }));
    render(<TabDocker addToast={() => {}} />);
    expect(await screen.findByText(/Docker daemon unreachable/)).toBeInTheDocument();
    expect(screen.queryByText("No containers found.")).not.toBeInTheDocument();
  });

  test("genuinely empty container list shows the empty state", async () => {
    mockFetchRouter(() => ({ ...DASHBOARD, containers: [] }));
    render(<TabDocker addToast={() => {}} />);
    expect(await screen.findByText("No containers found.")).toBeInTheDocument();
  });

  test("Restart calls the real endpoint without a confirmation step (self-healing, lower risk — deliberate scope decision)", async () => {
    let restarted = false;
    const onToast = jest.fn();
    mockFetchRouter((path, options) => {
      if (path === "/computer/docker/containers/c1/restart" && options?.method === "POST") { restarted = true; return { ok: true }; }
      return DASHBOARD;
    });
    const user = userEvent.setup();
    render(<TabDocker addToast={onToast} />);
    await user.click(await screen.findByText("Restart"));
    await waitFor(() => expect(restarted).toBe(true));
    expect(onToast).toHaveBeenCalledWith("restart c1: ok", "success");
  });

  test("REGRESSION GUARD (P1 fix): Stop requires confirmation naming the real container before any network call fires", async () => {
    const mock = mockFetchRouter(() => DASHBOARD);
    const user = userEvent.setup();
    render(<TabDocker addToast={() => {}} />);
    await user.click(await screen.findByText("Stop"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/ooplix-worker/)).toBeInTheDocument();
    expect(within(dialog).getByText(/will not restart on its own/)).toBeInTheDocument();
    expect(mock.mock.calls.some(([url]) => String(url).includes("/stop"))).toBe(false);
  });

  test("cancelling Stop makes no network call and the container keeps running", async () => {
    const mock = mockFetchRouter(() => DASHBOARD);
    const user = userEvent.setup();
    render(<TabDocker addToast={() => {}} />);
    await user.click(await screen.findByText("Stop"));
    const dialog = await screen.findByRole("dialog");
    const callsBefore = mock.mock.calls.length;
    await user.click(within(dialog).getByText("Cancel"));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mock.mock.calls.length).toBe(callsBefore);
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  test("confirming Stop calls the real endpoint and shows success", async () => {
    let stopped = false;
    const onToast = jest.fn();
    mockFetchRouter((path, options) => {
      if (path === "/computer/docker/containers/c1/stop" && options?.method === "POST") { stopped = true; return { ok: true }; }
      return DASHBOARD;
    });
    const user = userEvent.setup();
    render(<TabDocker addToast={onToast} />);
    await user.click(await screen.findByText("Stop"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Stop"));

    await waitFor(() => expect(stopped).toBe(true));
    expect(onToast).toHaveBeenCalledWith("stop c1: ok", "success");
  });

  test("REGRESSION GUARD: a failed Stop shows a real error toast, not a silent success", async () => {
    const onToast = jest.fn();
    mockFetchRouter((path, options) => {
      if (path === "/computer/docker/containers/c1/stop" && options?.method === "POST") {
        return jsonResponse({ error: "Permission denied" }, { ok: false, status: 403 });
      }
      return DASHBOARD;
    });
    const user = userEvent.setup();
    render(<TabDocker addToast={onToast} />);
    await user.click(await screen.findByText("Stop"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Stop"));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith("stop c1 failed: Permission denied", "error"));
    expect(onToast).not.toHaveBeenCalledWith("stop c1: ok", "success");
  });

  test("duplicate-submit protection: Stop is disabled mid-flight", async () => {
    let resolveStop;
    mockFetchRouter((path, options) => {
      if (path === "/computer/docker/containers/c1/stop" && options?.method === "POST") {
        return new Promise((res) => { resolveStop = () => res(jsonResponse({ ok: true })); });
      }
      return DASHBOARD;
    });
    const user = userEvent.setup();
    render(<TabDocker addToast={() => {}} />);
    await user.click(await screen.findByText("Stop"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Stop"));

    expect(screen.getByText("Stop", { selector: "button" })).toBeDisabled();
    resolveStop();
    await waitFor(() => expect(screen.getByText("Stop", { selector: "button" })).toBeEnabled());
  });
});
