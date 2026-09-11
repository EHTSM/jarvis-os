import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExtRuntimePanel } from "./WorkspaceSettingsL3";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

const ACTIVE_EXT = {
  id: "my-plugin", state: "active", hooks: ["onLoad"], crashCount: 0, restartCount: 0,
};

afterEach(() => restoreFetch());

describe("WorkspaceSettingsL3 ExtRuntimePanel — destructive Extension Unload requires confirmation", () => {
  test("REGRESSION GUARD (P1 fix): Unload requires confirmation naming the real extension before any network call fires", async () => {
    const mock = mockFetchRouter((path) => {
      if (path === "/extensions/runtime") return { extensions: [ACTIVE_EXT] };
      return {};
    });
    const user = userEvent.setup();
    render(<ExtRuntimePanel />);
    await user.click(await screen.findByText("Unload"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Unload "my-plugin"\?/)).toBeInTheDocument();
    expect(mock.mock.calls.some(([url]) => String(url).includes("/extensions/unload"))).toBe(false);
  });

  test("cancelling the Unload confirmation makes no network call", async () => {
    const mock = mockFetchRouter((path) => {
      if (path === "/extensions/runtime") return { extensions: [ACTIVE_EXT] };
      return {};
    });
    const user = userEvent.setup();
    render(<ExtRuntimePanel />);
    await user.click(await screen.findByText("Unload"));
    const dialog = await screen.findByRole("dialog");
    const callsBefore = mock.mock.calls.length;
    await user.click(within(dialog).getByText("Cancel"));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mock.mock.calls.length).toBe(callsBefore);
  });

  test("confirming Unload calls the real endpoint", async () => {
    let unloaded = false;
    mockFetchRouter((path, options) => {
      if (path === "/extensions/unload" && options?.method === "POST") {
        unloaded = true;
        expect(JSON.parse(options.body)).toEqual({ extId: "my-plugin" });
        return { success: true };
      }
      if (path === "/extensions/runtime") return { extensions: [ACTIVE_EXT] };
      return {};
    });
    const user = userEvent.setup();
    render(<ExtRuntimePanel />);
    await user.click(await screen.findByText("Unload"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Unload"));

    await waitFor(() => expect(unloaded).toBe(true));
  });

  test("Suspend (reversible, non-destructive) still fires immediately with no confirmation gate", async () => {
    let suspended = false;
    mockFetchRouter((path, options) => {
      if (path === "/extensions/suspend" && options?.method === "POST") { suspended = true; return { success: true }; }
      if (path === "/extensions/runtime") return { extensions: [ACTIVE_EXT] };
      return {};
    });
    const user = userEvent.setup();
    render(<ExtRuntimePanel />);
    await user.click(await screen.findByText("Suspend"));

    await waitFor(() => expect(suspended).toBe(true));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
