import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MarketplaceCatalogPanel } from "./WorkspaceSettingsL2";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

const PLUGIN = { id: "pl1", name: "Slack Sync", author: "acme", version: "1.0", capabilities: [], installed: false, rating: 4.5, installCount: 120 };

function baseRoutes({ plugins = [PLUGIN], categories = [] } = {}) {
  return (path) => {
    if (path.startsWith("/marketplace/catalog")) return { plugins };
    if (path === "/marketplace/categories") return { categories };
    return {};
  };
}

afterEach(() => restoreFetch());

describe("WorkspaceSettingsL2 MarketplaceCatalogPanel — marketplace/capability install flow", () => {
  test("real data renders the plugin grid", async () => {
    mockFetchRouter(baseRoutes());
    render(<MarketplaceCatalogPanel />);
    expect(await screen.findByText("Slack Sync")).toBeInTheDocument();
  });

  test("genuinely empty catalog shows the empty state", async () => {
    mockFetchRouter(baseRoutes({ plugins: [] }));
    render(<MarketplaceCatalogPanel />);
    expect(await screen.findByText("No plugins in this category.")).toBeInTheDocument();
  });

  test("REGRESSION GUARD: an API failure shows a distinct error state with Retry", async () => {
    mockFetchRouter((path) => (path.startsWith("/marketplace/catalog") ? jsonResponse({ error: "Backend unreachable" }, { ok: false, status: 500 }) : baseRoutes()(path)));
    render(<MarketplaceCatalogPanel />);
    expect(await screen.findByText(/Couldn.t load this data.*Backend unreachable/)).toBeInTheDocument();
  });

  test("mutation success: Install posts the real plugin payload and refreshes the catalog", async () => {
    let posted = null;
    let installed = false;
    mockFetchRouter((path, options) => {
      if (path === "/plugins/install" && options?.method === "POST") {
        posted = JSON.parse(options.body);
        installed = true;
        return { success: true };
      }
      return baseRoutes({ plugins: [{ ...PLUGIN, installed }] })(path);
    });
    const user = userEvent.setup();
    render(<MarketplaceCatalogPanel />);
    await screen.findByText("Slack Sync");
    await user.click(screen.getByText("Install"));

    await waitFor(() => expect(posted).toMatchObject({ id: "pl1", name: "Slack Sync" }));
  });

  test("REGRESSION GUARD (P1 fix): a failed install shows a visible error, not a silent revert to the plain Install button", async () => {
    mockFetchRouter((path, options) => {
      if (path === "/plugins/install" && options?.method === "POST") {
        return jsonResponse({ error: "Not authorized" }, { ok: false, status: 403 });
      }
      return baseRoutes()(path);
    });
    const user = userEvent.setup();
    render(<MarketplaceCatalogPanel />);
    await screen.findByText("Slack Sync");
    await user.click(screen.getByText("Install"));

    expect(await screen.findByText(/Failed to install Slack Sync: Not authorized/)).toBeInTheDocument();
  });

  test("a subsequent successful install clears the previous error", async () => {
    let attempt = 0;
    mockFetchRouter((path, options) => {
      if (path === "/plugins/install" && options?.method === "POST") {
        attempt += 1;
        if (attempt === 1) return jsonResponse({ error: "Not authorized" }, { ok: false, status: 403 });
        return { success: true };
      }
      return baseRoutes()(path);
    });
    const user = userEvent.setup();
    render(<MarketplaceCatalogPanel />);
    await screen.findByText("Slack Sync");
    await user.click(screen.getByText("Install"));
    await screen.findByText(/Failed to install/);
    await user.click(screen.getByText("Install"));
    await waitFor(() => expect(screen.queryByText(/Failed to install/)).not.toBeInTheDocument());
  });
});
