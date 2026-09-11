import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabAlerts } from "./DevOpsCenterV2";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

const OPEN_ALERT = {
  id: "real-alert-1", title: "Disk usage above threshold", severity: "warning", status: "open",
  service: "backend", created: "2m ago", detail: "Disk usage at 92%",
};

afterEach(() => restoreFetch());

describe("DevOpsCenterV2 TabAlerts — resolve must not be presented as successful when it fails", () => {
  test("a successful resolve marks the alert resolved and shows a success toast", async () => {
    const onToast = jest.fn();
    mockFetchRouter((path, options) => {
      if (path === "/p25/obs/alerts/real-alert-1/resolve" && options?.method === "POST") return { success: true };
      if (path.startsWith("/p25/obs/alerts")) return { alerts: [OPEN_ALERT] };
      return {};
    });
    const user = userEvent.setup();
    render(<TabAlerts addToast={onToast} />);
    await user.click(await screen.findByText("Disk usage above threshold"));
    await user.click(screen.getByText("✓ Mark Resolved"));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith(
      expect.stringContaining("Alert resolved"), "success",
    ), { timeout: 10000 });
  }, 15000);

  test("REGRESSION GUARD (P1 fix): a failed resolve (backend error) shows a real error, never a false 'resolved' success", async () => {
    const onToast = jest.fn();
    mockFetchRouter((path, options) => {
      if (path === "/p25/obs/alerts/real-alert-1/resolve" && options?.method === "POST") {
        return jsonResponse({ error: "Service unavailable" }, { ok: false, status: 503 });
      }
      if (path.startsWith("/p25/obs/alerts")) return { alerts: [OPEN_ALERT] };
      return {};
    });
    const user = userEvent.setup();
    render(<TabAlerts addToast={onToast} />);
    await user.click(await screen.findByText("Disk usage above threshold"));
    await user.click(screen.getByText("✓ Mark Resolved"));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith(
      expect.stringContaining("Resolve failed"), "error",
    ));
    // Previously this catch block optimistically marked the alert resolved
    // and toasted "Alert marked resolved" at info severity even on failure.
    expect(onToast).not.toHaveBeenCalledWith("Alert marked resolved", "info");
    expect(onToast).not.toHaveBeenCalledWith(
      expect.stringContaining("Alert resolved"), "success",
    );
    // The alert must remain visibly open, not silently flipped to resolved —
    // the status pill (not the "open" filter chip) is the source of truth here.
    expect(screen.getAllByText("open").length).toBeGreaterThan(0);
  });

  test("REGRESSION GUARD (P1 fix): a network failure on resolve also surfaces as an error, not a false success", async () => {
    const onToast = jest.fn();
    mockFetchRouter((path, options) => {
      if (path === "/p25/obs/alerts/real-alert-1/resolve" && options?.method === "POST") {
        throw new Error("Network error");
      }
      if (path.startsWith("/p25/obs/alerts")) return { alerts: [OPEN_ALERT] };
      return {};
    });
    const user = userEvent.setup();
    render(<TabAlerts addToast={onToast} />);
    await user.click(await screen.findByText("Disk usage above threshold"));
    await user.click(screen.getByText("✓ Mark Resolved"));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith(
      expect.stringContaining("Resolve failed"), "error",
    ));
    expect(onToast).not.toHaveBeenCalledWith("Alert marked resolved", "info");
  });
});
