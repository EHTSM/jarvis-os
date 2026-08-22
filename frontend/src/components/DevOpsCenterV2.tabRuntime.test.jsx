import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabRuntime } from "./DevOpsCenterV2";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

// The page also renders a plain, non-interactive status row labeled
// "Emergency Stop" (ACTIVE/INACTIVE) alongside the real button of the same
// text — getByRole("button", {name: ...}) is required to target the actual
// control rather than that status label.
const stopBtn   = () => screen.getByRole("button", { name: /Emergency Stop/ });
const resumeBtn = () => screen.getByRole("button", { name: /Resume Execution/ });

const NORMAL_STATUS = { mode: "normal", emergencyStop: false, queue: { pending: 2, running: 1, failed: 0 } };
const EMERGENCY_STATUS = { mode: "emergency", emergencyStop: true, queue: { pending: 0, running: 0, failed: 0 } };

afterEach(() => restoreFetch());

describe("DevOpsCenterV2 TabRuntime — the app's single most destructive control: Emergency Stop / Resume / Restart", () => {
  test("loading resolves to real runtime status, not a fabricated default", async () => {
    mockFetchRouter((path) => {
      if (path === "/runtime/status") return NORMAL_STATUS;
      if (path.startsWith("/runtime/history")) return { history: [] };
      return {};
    });
    render(<TabRuntime addToast={() => {}} />);
    expect(await screen.findByRole("button", { name: /Emergency Stop/ })).toBeInTheDocument();
    expect(screen.queryByText(/EMERGENCY STOP ACTIVE/)).not.toBeInTheDocument();
  });

  test("emergency banner renders when the real status reports emergencyStop:true", async () => {
    mockFetchRouter((path) => {
      if (path === "/runtime/status") return EMERGENCY_STATUS;
      if (path.startsWith("/runtime/history")) return { history: [] };
      return {};
    });
    render(<TabRuntime addToast={() => {}} />);
    expect(await screen.findByText(/EMERGENCY STOP ACTIVE/)).toBeInTheDocument();
  });

  test("REGRESSION GUARD (P1 fix): clicking Emergency Stop requires explicit confirmation before any network call fires", async () => {
    const mock = mockFetchRouter((path) => {
      if (path === "/runtime/status") return NORMAL_STATUS;
      if (path.startsWith("/runtime/history")) return { history: [] };
      return jsonResponse({ success: true });
    });
    const user = userEvent.setup();
    render(<TabRuntime addToast={() => {}} />);
    await screen.findByRole("button", { name: /Emergency Stop/ });

    await user.click(stopBtn());
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/halts all queued and in-flight tasks for every customer/)).toBeInTheDocument();
    // no /runtime/emergency/stop call yet — only the confirmation dialog opened
    expect(mock.mock.calls.some(([url]) => String(url).includes("/runtime/emergency/stop"))).toBe(false);
  });

  test("cancelling the Emergency Stop confirmation makes no network call and leaves the platform running", async () => {
    const mock = mockFetchRouter((path) => {
      if (path === "/runtime/status") return NORMAL_STATUS;
      if (path.startsWith("/runtime/history")) return { history: [] };
      return jsonResponse({ success: true });
    });
    const user = userEvent.setup();
    render(<TabRuntime addToast={() => {}} />);
    await screen.findByRole("button", { name: /Emergency Stop/ });
    await user.click(stopBtn());
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Cancel"));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mock.mock.calls.some(([url]) => String(url).includes("/runtime/emergency/stop"))).toBe(false);
    expect(screen.queryByText(/EMERGENCY STOP ACTIVE/)).not.toBeInTheDocument();
  });

  test("confirming Emergency Stop calls the real endpoint and flips to the emergency banner", async () => {
    let stopped = false;
    mockFetchRouter((path, options) => {
      if (path === "/runtime/emergency/stop" && options?.method === "POST") { stopped = true; return { success: true }; }
      if (path === "/runtime/status") return NORMAL_STATUS;
      if (path.startsWith("/runtime/history")) return { history: [] };
      return {};
    });
    const onToast = jest.fn();
    const user = userEvent.setup();
    render(<TabRuntime addToast={onToast} />);
    await screen.findByRole("button", { name: /Emergency Stop/ });
    await user.click(stopBtn());
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Emergency Stop"));

    await waitFor(() => expect(stopped).toBe(true));
    expect(await screen.findByText(/EMERGENCY STOP ACTIVE/)).toBeInTheDocument();
    expect(onToast).toHaveBeenCalledWith("Emergency stop activated", "error");
  });

  test("REGRESSION GUARD (P1 fix): a failed Emergency Stop shows a failure toast and does NOT claim it was activated", async () => {
    mockFetchRouter((path, options) => {
      if (path === "/runtime/emergency/stop" && options?.method === "POST") {
        return jsonResponse({ error: "Runtime coordinator unreachable" }, { ok: false, status: 503 });
      }
      if (path === "/runtime/status") return NORMAL_STATUS;
      if (path.startsWith("/runtime/history")) return { history: [] };
      return {};
    });
    const onToast = jest.fn();
    const user = userEvent.setup();
    render(<TabRuntime addToast={onToast} />);
    await screen.findByRole("button", { name: /Emergency Stop/ });
    await user.click(stopBtn());
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Emergency Stop"));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith("Stop failed: Runtime coordinator unreachable", "error"));
    expect(onToast).not.toHaveBeenCalledWith("Emergency stop activated", "error");
    expect(screen.queryByText(/EMERGENCY STOP ACTIVE/)).not.toBeInTheDocument();
  });

  test("duplicate-submit protection: Emergency Stop is disabled and busy-labeled mid-flight", async () => {
    let resolveStop;
    mockFetchRouter((path, options) => {
      if (path === "/runtime/emergency/stop" && options?.method === "POST") {
        return new Promise((res) => { resolveStop = () => res(jsonResponse({ success: true })); });
      }
      if (path === "/runtime/status") return NORMAL_STATUS;
      if (path.startsWith("/runtime/history")) return { history: [] };
      return {};
    });
    const user = userEvent.setup();
    render(<TabRuntime addToast={() => {}} />);
    await screen.findByRole("button", { name: /Emergency Stop/ });
    await user.click(stopBtn());
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Emergency Stop"));

    const busyBtn = screen.getByRole("button", { name: /Stopping…/ });
    expect(busyBtn).toBeDisabled();
    resolveStop();
    await waitFor(() => expect(screen.queryByText("Stopping…")).not.toBeInTheDocument());
  });

  test("Resume Execution is disabled when not in emergency mode (nothing to resume)", async () => {
    mockFetchRouter((path) => {
      if (path === "/runtime/status") return NORMAL_STATUS;
      if (path.startsWith("/runtime/history")) return { history: [] };
      return {};
    });
    render(<TabRuntime addToast={() => {}} />);
    await screen.findByRole("button", { name: /Emergency Stop/ });
    expect(resumeBtn()).toBeDisabled();
  });

  test("Resume Execution calls the real endpoint and clears the emergency banner", async () => {
    let resumed = false;
    mockFetchRouter((path, options) => {
      if (path === "/runtime/emergency/resume" && options?.method === "POST") { resumed = true; return { success: true }; }
      if (path === "/runtime/status") return EMERGENCY_STATUS;
      if (path.startsWith("/runtime/history")) return { history: [] };
      return {};
    });
    const onToast = jest.fn();
    const user = userEvent.setup();
    render(<TabRuntime addToast={onToast} />);
    await screen.findByText(/EMERGENCY STOP ACTIVE/);
    await user.click(resumeBtn());

    await waitFor(() => expect(resumed).toBe(true));
    expect(onToast).toHaveBeenCalledWith("Execution resumed", "success");
    await waitFor(() => expect(screen.queryByText(/EMERGENCY STOP ACTIVE/)).not.toBeInTheDocument());
  });

  test("REGRESSION GUARD (P1 fix): a failed Resume shows a failure toast and the platform stays visibly in emergency mode", async () => {
    mockFetchRouter((path, options) => {
      if (path === "/runtime/emergency/resume" && options?.method === "POST") {
        return jsonResponse({ error: "Coordinator busy" }, { ok: false, status: 503 });
      }
      if (path === "/runtime/status") return EMERGENCY_STATUS;
      if (path.startsWith("/runtime/history")) return { history: [] };
      return {};
    });
    const onToast = jest.fn();
    const user = userEvent.setup();
    render(<TabRuntime addToast={onToast} />);
    await screen.findByText(/EMERGENCY STOP ACTIVE/);
    await user.click(resumeBtn());

    await waitFor(() => expect(onToast).toHaveBeenCalledWith("Resume failed: Coordinator busy", "error"));
    expect(onToast).not.toHaveBeenCalledWith("Execution resumed", "success");
    expect(screen.getByText(/EMERGENCY STOP ACTIVE/)).toBeInTheDocument();
  });
});
