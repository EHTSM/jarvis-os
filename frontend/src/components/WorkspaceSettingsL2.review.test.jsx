import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PluginDetail } from "./WorkspaceSettingsL2";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

const PLUGIN = { id: "p1", name: "Slack Sync", author: "acme", version: "1.0" };

afterEach(() => restoreFetch());

async function fillAndSubmit(user, text = "Great plugin") {
  const textarea = screen.getByPlaceholderText("Share your experience…");
  await user.type(textarea, text);
  await user.click(screen.getByText("Submit Review"));
}

describe("WorkspaceSettingsL2 PluginDetail — forms/validation + mutations (categories 4 & 5)", () => {
  test("Submit Review is disabled until the textarea has content (form validation)", async () => {
    mockFetchRouter(() => ({}));
    render(<PluginDetail plugin={PLUGIN} onClose={() => {}} onInstall={() => {}} />);
    expect(screen.getByText("Submit Review")).toBeDisabled();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Share your experience…"), "x");
    expect(screen.getByText("Submit Review")).toBeEnabled();
  });

  test("successful submit clears the draft and refreshes reviews (happy path mutation)", async () => {
    let posted = null;
    mockFetchRouter((path, options) => {
      if (path === `/marketplace/plugin/${PLUGIN.id}/review` && options?.method === "POST") {
        posted = JSON.parse(options.body);
        return { success: true };
      }
      if (path === `/marketplace/plugin/${PLUGIN.id}`) return { plugin: { reviews: [{ id: "r1", body: "nice" }] } };
      if (path === `/marketplace/changelog/${PLUGIN.id}`) return { changelog: [] };
      return {};
    });

    render(<PluginDetail plugin={PLUGIN} onClose={() => {}} onInstall={() => {}} />);
    const user = userEvent.setup();
    await fillAndSubmit(user, "Great plugin");

    await waitFor(() => expect(screen.getByPlaceholderText("Share your experience…").value).toBe(""));
    expect(posted).toMatchObject({ body: "Great plugin" });
  });

  test("REGRESSION GUARD: a failed submit shows an error and does NOT silently clear the user's draft", async () => {
    mockFetchRouter((path, options) => {
      if (path === `/marketplace/plugin/${PLUGIN.id}/review` && options?.method === "POST") {
        return jsonResponse({ error: "Server unavailable" }, { ok: false, status: 500 });
      }
      if (path === `/marketplace/plugin/${PLUGIN.id}`) return { plugin: { reviews: [] } };
      if (path === `/marketplace/changelog/${PLUGIN.id}`) return { changelog: [] };
      return {};
    });

    render(<PluginDetail plugin={PLUGIN} onClose={() => {}} onInstall={() => {}} />);
    const user = userEvent.setup();
    await fillAndSubmit(user, "This took real effort to write");

    await waitFor(() => expect(screen.getByText(/Server unavailable/)).toBeInTheDocument());
    // The whole point of the fix: don't discard what the user typed on failure.
    expect(screen.getByPlaceholderText("Share your experience…").value).toBe("This took real effort to write");
  });

  test("submit button shows a busy state and is not double-clickable mid-flight", async () => {
    let resolvePost;
    mockFetchRouter((path, options) => {
      if (path === `/marketplace/plugin/${PLUGIN.id}/review` && options?.method === "POST") {
        return new Promise((res) => { resolvePost = () => res(jsonResponse({ success: true })); });
      }
      if (path === `/marketplace/plugin/${PLUGIN.id}`) return { plugin: { reviews: [] } };
      if (path === `/marketplace/changelog/${PLUGIN.id}`) return { changelog: [] };
      return {};
    });

    render(<PluginDetail plugin={PLUGIN} onClose={() => {}} onInstall={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Share your experience…"), "hi");
    await user.click(screen.getByText("Submit Review"));

    expect(screen.getByText("Submitting…")).toBeInTheDocument();
    expect(screen.getByText("Submitting…")).toBeDisabled();

    await act(async () => { resolvePost(); await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => expect(screen.queryByText("Submitting…")).not.toBeInTheDocument());
  });
});
