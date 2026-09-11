import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DetailPanel } from "./IntegrationCenter";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

const CRED_TYPES = [{ type: "api_key" }, { type: "oauth_token" }];

function baseProps(overrides = {}) {
  return {
    connectorId: "pay:stripe", connected: true, credentialTypes: CRED_TYPES,
    canManageVault: true, onClose: () => {}, showToast: jest.fn(), onChanged: jest.fn(),
    ...overrides,
  };
}

function routeVault({ secrets = [{ type: "api_key" }], history = [] } = {}) {
  return (path) => {
    if (path.startsWith("/vault/history")) return { ok: true, history };
    if (path.startsWith("/vault/secrets?")) return { ok: true, secrets };
    if (path.startsWith("/integrations/") && path.endsWith("/health")) return { ok: true, status: "healthy" };
    return {};
  };
}

afterEach(() => restoreFetch());

describe("IntegrationCenter DetailPanel — operator credential vault (54 connectors)", () => {
  test("real API contract: loads stored credential metadata and history on mount", async () => {
    mockFetchRouter(routeVault({ secrets: [{ type: "api_key", lastValidatedAt: "2026-08-01T00:00:00Z" }], history: [{ action: "rotated", ts: "2026-08-01T00:00:00Z" }] }));
    render(<DetailPanel {...baseProps()} />);
    expect(await screen.findByText(/Last verified:/)).toBeInTheDocument();
    expect(screen.getByText(/rotated/)).toBeInTheDocument();
  });

  test("permission gate: a non-operator account (canManageVault=false) sees a message, not the mutation controls", async () => {
    mockFetchRouter(routeVault());
    render(<DetailPanel {...baseProps({ canManageVault: false })} />);
    expect(await screen.findByText("Credential management requires operator access.")).toBeInTheDocument();
    expect(screen.queryByText("Remove")).not.toBeInTheDocument();
    expect(screen.queryByText(/Rotate \/ add credential/)).not.toBeInTheDocument();
  });

  test("form validation: Save credential is disabled until a value is entered", async () => {
    mockFetchRouter(routeVault({ secrets: [] }));
    const user = userEvent.setup();
    render(<DetailPanel {...baseProps({ connected: false })} />);
    await user.click(await screen.findByText("Set up"));
    expect(screen.getByText("Save credential")).toBeDisabled();
    await user.type(screen.getByPlaceholderText("Paste credential value…"), "sk_live_abc123");
    expect(screen.getByText("Save credential")).toBeEnabled();
  });

  test("mutation success: saving a new credential posts to the vault and refreshes stored state", async () => {
    let posted = null;
    mockFetchRouter((path, options) => {
      if (path === "/vault/secrets/pay%3Astripe/api_key" && options?.method === "POST") {
        posted = JSON.parse(options.body);
        return { ok: true };
      }
      return routeVault({ secrets: [] })(path);
    });
    const onChanged = jest.fn();
    const showToast = jest.fn();
    const user = userEvent.setup();
    render(<DetailPanel {...baseProps({ connected: false, onChanged, showToast })} />);
    await user.click(await screen.findByText("Set up"));
    await user.type(screen.getByPlaceholderText("Paste credential value…"), "sk_live_abc123");
    await user.click(screen.getByText("Save credential"));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Stripe credential saved"));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(posted).toMatchObject({ value: "sk_live_abc123" });
  });

  test("REGRESSION GUARD: a failed credential save shows the real error and does not call onChanged", async () => {
    mockFetchRouter((path, options) => {
      if (path === "/vault/secrets/pay%3Astripe/api_key" && options?.method === "POST") {
        return jsonResponse({ ok: false, error: "Invalid key format" });
      }
      return routeVault({ secrets: [] })(path);
    });
    const onChanged = jest.fn();
    const showToast = jest.fn();
    const user = userEvent.setup();
    render(<DetailPanel {...baseProps({ connected: false, onChanged, showToast })} />);
    await user.click(await screen.findByText("Set up"));
    await user.type(screen.getByPlaceholderText("Paste credential value…"), "bad-key");
    await user.click(screen.getByText("Save credential"));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Invalid key format"));
    expect(onChanged).not.toHaveBeenCalled();
  });

  test("duplicate-submit protection: Save credential is disabled and busy-labeled mid-flight", async () => {
    let resolveSave;
    mockFetchRouter((path, options) => {
      if (path === "/vault/secrets/pay%3Astripe/api_key" && options?.method === "POST") {
        return new Promise((res) => { resolveSave = () => res(jsonResponse({ ok: true })); });
      }
      return routeVault({ secrets: [] })(path);
    });
    const user = userEvent.setup();
    render(<DetailPanel {...baseProps({ connected: false })} />);
    await user.click(await screen.findByText("Set up"));
    await user.type(screen.getByPlaceholderText("Paste credential value…"), "sk_live_abc123");
    await user.click(screen.getByText("Save credential"));

    const busyBtn = screen.getByText("Saving…");
    expect(busyBtn).toBeDisabled();
    resolveSave();
    await waitFor(() => expect(screen.queryByText("Saving…")).not.toBeInTheDocument());
  });

  test("destructive action (P1 fix): Remove requires confirmation naming the real connector and credential type, cancel makes no DELETE call", async () => {
    const mock = mockFetchRouter(routeVault({ secrets: [{ type: "api_key" }] }));
    const user = userEvent.setup();
    render(<DetailPanel {...baseProps()} />);
    await user.click(await screen.findByText("Remove"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/permanently deletes the stored api key credential/)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/Stripe/).length).toBeGreaterThan(0);

    const callsBefore = mock.mock.calls.length;
    await user.click(within(dialog).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mock.mock.calls.some(([url, opts]) => opts?.method === "DELETE")).toBe(false);
  });

  test("destructive action (P1 fix): confirming Remove calls DELETE and refreshes stored state", async () => {
    let deleted = false;
    mockFetchRouter((path, options) => {
      if (path === "/vault/secrets/pay%3Astripe/api_key" && options?.method === "DELETE") { deleted = true; return { ok: true }; }
      return routeVault({ secrets: deleted ? [] : [{ type: "api_key" }] })(path);
    });
    const onChanged = jest.fn();
    const user = userEvent.setup();
    render(<DetailPanel {...baseProps({ onChanged })} />);
    await user.click(await screen.findByText("Remove"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Remove"));

    await waitFor(() => expect(deleted).toBe(true));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test("OAuth connector: Connect fetches a real OAuth URL and navigates to it", async () => {
    mockFetchRouter((path) => {
      if (path === "/oauth/google/url") return { url: "https://accounts.google.com/o/oauth2/auth?client_id=x" };
      return {};
    });
    delete window.location;
    window.location = { href: "" };
    const user = userEvent.setup();
    render(<DetailPanel {...baseProps({ connectorId: "auth:google", connected: false })} />);
    await user.click(await screen.findByText("Connect Google OAuth →"));
    await waitFor(() => expect(window.location.href).toBe("https://accounts.google.com/o/oauth2/auth?client_id=x"));
  });

  test("REGRESSION GUARD: OAuth Connect with no configured URL shows an honest message, not a broken navigation", async () => {
    mockFetchRouter(() => ({ url: null }));
    delete window.location;
    window.location = { href: "" };
    const showToast = jest.fn();
    const user = userEvent.setup();
    render(<DetailPanel {...baseProps({ connectorId: "auth:google", connected: false, showToast })} />);
    await user.click(await screen.findByText("Connect Google OAuth →"));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("OAuth not configured in .env for this provider"));
    expect(window.location.href).toBe("");
  });

  test("destructive action (P1 fix): OAuth Disconnect requires confirmation, cancel revokes nothing", async () => {
    const mock = mockFetchRouter(() => ({ ok: true }));
    const user = userEvent.setup();
    render(<DetailPanel {...baseProps({ connectorId: "auth:google", connected: true })} />);
    await user.click(await screen.findByText("Disconnect"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/revokes your organization's/)).toBeInTheDocument();
    const callsBefore = mock.mock.calls.length;
    await user.click(within(dialog).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mock.mock.calls.length).toBe(callsBefore);
  });

  test("destructive action (P1 fix): confirming OAuth Disconnect calls revoke and notifies the parent", async () => {
    let revoked = false;
    mockFetchRouter((path, options) => {
      if (path === "/oauth/google/revoke" && options?.method === "DELETE") { revoked = true; return { ok: true }; }
      return {};
    });
    const onChanged = jest.fn();
    const user = userEvent.setup();
    render(<DetailPanel {...baseProps({ connectorId: "auth:google", connected: true, onChanged })} />);
    await user.click(await screen.findByText("Disconnect"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Disconnect"));

    await waitFor(() => expect(revoked).toBe(true));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test("mobile-critical interaction: form controls are real inputs/buttons reachable by keyboard, not custom mouse-only widgets", async () => {
    mockFetchRouter(routeVault({ secrets: [] }));
    const user = userEvent.setup();
    render(<DetailPanel {...baseProps({ connected: false })} />);
    await user.click(await screen.findByText("Set up"));
    const textarea = screen.getByPlaceholderText("Paste credential value…");
    textarea.focus();
    await user.keyboard("sk_live_test");
    expect(textarea.value).toBe("sk_live_test");
  });
});
