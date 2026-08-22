import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabRepos } from "./DeveloperCopilotV2";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

afterEach(() => restoreFetch());

async function switchToSymbolMode(user) {
  await user.click(await screen.findByText("Symbol Search"));
}

describe("DeveloperCopilotV2 TabRepos — symbol search (Mission 31 contract audit: /runtime/symbol-search has no backend route)", () => {
  test("real matches render with the correct match count", async () => {
    mockFetchRouter((path) => {
      if (path.startsWith("/runtime/symbol-search")) return { results: [{ file: "agents/executor.cjs", snippet: "function dispatch()" }] };
      return { repos: [] };
    });
    const user = userEvent.setup();
    render(<TabRepos addToast={() => {}} />);
    await switchToSymbolMode(user);
    await user.type(screen.getByPlaceholderText(/Symbol name to find/), "dispatch");
    await user.click(screen.getByText("Find"));

    expect(await screen.findByText('1 match for "dispatch"')).toBeInTheDocument();
  });

  test("genuinely no matches shows the honest empty message with no error", async () => {
    mockFetchRouter((path) => {
      if (path.startsWith("/runtime/symbol-search")) return { results: [] };
      return { repos: [] };
    });
    const user = userEvent.setup();
    render(<TabRepos addToast={() => {}} />);
    await switchToSymbolMode(user);
    await user.type(screen.getByPlaceholderText(/Symbol name to find/), "doesNotExist");
    await user.click(screen.getByText("Find"));

    expect(await screen.findByText("Symbol not found in codebase.")).toBeInTheDocument();
    expect(screen.getByText('0 matches for "doesNotExist"')).toBeInTheDocument();
  });

  test("REGRESSION GUARD (P2 fix): a real backend failure (e.g. the missing /runtime/symbol-search route) shows the error, not a misleading '0 matches'", async () => {
    mockFetchRouter((path) => {
      if (path.startsWith("/runtime/symbol-search")) return jsonResponse({ error: "HTTP 404" }, { ok: false, status: 404 });
      return { repos: [] };
    });
    const user = userEvent.setup();
    render(<TabRepos addToast={() => {}} />);
    await switchToSymbolMode(user);
    await user.type(screen.getByPlaceholderText(/Symbol name to find/), "dispatch");
    await user.click(screen.getByText("Find"));

    await waitFor(() => expect(screen.getByText(/HTTP 404|Symbol search unavailable/)).toBeInTheDocument());
  });

  test("duplicate-submit protection: Find is disabled and busy-labeled mid-flight", async () => {
    let resolveSearch;
    mockFetchRouter((path) => {
      if (path.startsWith("/runtime/symbol-search")) return new Promise((res) => { resolveSearch = () => res(jsonResponse({ results: [] })); });
      return { repos: [] };
    });
    const user = userEvent.setup();
    render(<TabRepos addToast={() => {}} />);
    await switchToSymbolMode(user);
    await user.type(screen.getByPlaceholderText(/Symbol name to find/), "dispatch");
    await user.click(screen.getByText("Find"));

    const busyBtn = screen.getByText("⟳");
    expect(busyBtn).toBeDisabled();
    resolveSearch();
    await waitFor(() => expect(screen.queryByText("⟳")).not.toBeInTheDocument());
  });
});
