import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabPatches } from "./DevOpsCenterV2";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

const PENDING_PATCH = {
  id: "p1", filePath: "backend/services/foo.cjs", status: "pending",
  description: "Fix null check", diff: { linesAdded: 3, linesRemoved: 1 }, proposedAt: new Date().toISOString(),
};
const APPLIED_PATCH = { ...PENDING_PATCH, id: "p2", status: "applied" };

afterEach(() => restoreFetch());

describe("DevOpsCenterV2 TabPatches — AI patch Apply/Revert (destructive repo-file writes)", () => {
  test("REGRESSION GUARD (P1 fix): Apply requires confirmation naming the real file before any network call fires", async () => {
    const mock = mockFetchRouter((path) => {
      if (path.startsWith("/runtime/patches")) return { patches: [PENDING_PATCH] };
      return {};
    });
    const user = userEvent.setup();
    render(<TabPatches addToast={() => {}} />);
    await user.click(await screen.findByText("backend/services/foo.cjs"));
    await user.click(screen.getByText("Apply"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Apply patch to backend\/services\/foo\.cjs/)).toBeInTheDocument();
    expect(mock.mock.calls.some(([url]) => String(url).includes("/apply"))).toBe(false);
  });

  test("cancelling the Apply confirmation makes no network call", async () => {
    const mock = mockFetchRouter((path) => {
      if (path.startsWith("/runtime/patches")) return { patches: [PENDING_PATCH] };
      return {};
    });
    const user = userEvent.setup();
    render(<TabPatches addToast={() => {}} />);
    await user.click(await screen.findByText("backend/services/foo.cjs"));
    await user.click(screen.getByText("Apply"));
    const dialog = await screen.findByRole("dialog");
    const callsBefore = mock.mock.calls.length;
    await user.click(within(dialog).getByText("Cancel"));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mock.mock.calls.length).toBe(callsBefore);
  });

  test("confirming Apply calls the real endpoint and shows a genuine success toast", async () => {
    let applied = false;
    const onToast = jest.fn();
    mockFetchRouter((path, options) => {
      if (path === "/runtime/patches/p1/apply" && options?.method === "POST") { applied = true; return { success: true }; }
      if (path.startsWith("/runtime/patches")) return { patches: [PENDING_PATCH] };
      return {};
    });
    const user = userEvent.setup();
    render(<TabPatches addToast={onToast} />);
    await user.click(await screen.findByText("backend/services/foo.cjs"));
    await user.click(screen.getByText("Apply"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Apply"));

    await waitFor(() => expect(applied).toBe(true));
    expect(onToast).toHaveBeenCalledWith("Applied patch to backend/services/foo.cjs", "success");
  });

  test("REGRESSION GUARD (P1 fix): Revert requires confirmation naming the real file before any network call fires", async () => {
    const mock = mockFetchRouter((path) => {
      if (path.startsWith("/runtime/patches")) return { patches: [APPLIED_PATCH] };
      return {};
    });
    const user = userEvent.setup();
    render(<TabPatches addToast={() => {}} />);
    await user.click(await screen.findByText("backend/services/foo.cjs"));
    await user.click(screen.getByText("↩ Rollback"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Revert patch to backend\/services\/foo\.cjs/)).toBeInTheDocument();
    expect(mock.mock.calls.some(([url]) => String(url).includes("/rollback"))).toBe(false);
  });

  test("confirming Revert calls the real endpoint and shows a genuine success toast", async () => {
    let rolledBack = false;
    const onToast = jest.fn();
    mockFetchRouter((path, options) => {
      if (path === "/runtime/patches/p2/rollback" && options?.method === "POST") { rolledBack = true; return { success: true }; }
      if (path.startsWith("/runtime/patches")) return { patches: [APPLIED_PATCH] };
      return {};
    });
    const user = userEvent.setup();
    render(<TabPatches addToast={onToast} />);
    await user.click(await screen.findByText("backend/services/foo.cjs"));
    await user.click(screen.getByText("↩ Rollback"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Revert"));

    await waitFor(() => expect(rolledBack).toBe(true));
    expect(onToast).toHaveBeenCalledWith("Rolled back backend/services/foo.cjs", "success");
  });

  test("a failed Apply shows the real error, not a false success", async () => {
    const onToast = jest.fn();
    mockFetchRouter((path, options) => {
      if (path === "/runtime/patches/p1/apply" && options?.method === "POST") {
        return jsonResponse({ success: false, error: "File no longer exists" }, { ok: true });
      }
      if (path.startsWith("/runtime/patches")) return { patches: [PENDING_PATCH] };
      return {};
    });
    const user = userEvent.setup();
    render(<TabPatches addToast={onToast} />);
    await user.click(await screen.findByText("backend/services/foo.cjs"));
    await user.click(screen.getByText("Apply"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Apply"));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith("Apply failed: File no longer exists", "error"));
    expect(onToast).not.toHaveBeenCalledWith("Applied patch to backend/services/foo.cjs", "success");
  });
});
