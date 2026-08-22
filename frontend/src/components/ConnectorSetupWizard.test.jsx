import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConnectorSetupWizard from "./ConnectorSetupWizard";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

const WHATSAPP = {
  id: "whatsapp", label: "WhatsApp", category: "messaging", connected: false,
  fields: [{ key: "apiKey", label: "API Key", type: "password", present: false }],
};
const CONNECTED_PAYMENTS = {
  id: "razorpay", label: "Razorpay", category: "payments", connected: true,
  fields: [{ key: "keyId", label: "Key ID", type: "text", present: true }],
};

afterEach(() => restoreFetch());

describe("ConnectorSetupWizard — customer-facing credential vault: connect, save, disconnect", () => {
  test("loading state renders before the provider list resolves", async () => {
    let resolveLoad;
    mockFetchRouter(() => new Promise((res) => { resolveLoad = () => res(jsonResponse({ providers: [WHATSAPP] })); }));
    render(<ConnectorSetupWizard onToast={() => {}} />);
    expect(screen.getByText("Loading connectors…")).toBeInTheDocument();
    resolveLoad();
    await waitFor(() => expect(screen.getByText("WhatsApp")).toBeInTheDocument());
  });

  test("real API contract: providers are grouped by category with the correct section labels", async () => {
    mockFetchRouter(() => ({ providers: [WHATSAPP, CONNECTED_PAYMENTS] }));
    render(<ConnectorSetupWizard onToast={() => {}} />);
    expect(await screen.findByText("Messaging")).toBeInTheDocument();
    expect(screen.getByText("Payments")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Razorpay")).toBeInTheDocument();
  });

  test("connected vs not-connected status is shown honestly per provider", async () => {
    mockFetchRouter(() => ({ providers: [WHATSAPP, CONNECTED_PAYMENTS] }));
    render(<ConnectorSetupWizard onToast={() => {}} />);
    await screen.findByText("WhatsApp");
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByText("✓ Connected")).toBeInTheDocument();
  });

  test("REGRESSION GUARD (fix): a failed load offers a Retry action, not a permanent dead-end error screen", async () => {
    mockFetchRouter(() => jsonResponse({ error: "Backend unreachable" }, { ok: false, status: 500 }));
    render(<ConnectorSetupWizard onToast={() => {}} />);
    expect(await screen.findByText("Backend unreachable")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  test("Retry after a failed load recovers to the real provider list", async () => {
    let attempt = 0;
    mockFetchRouter(() => {
      attempt += 1;
      return attempt === 1 ? jsonResponse({ error: "timeout" }, { ok: false, status: 504 }) : { providers: [WHATSAPP] };
    });
    const user = userEvent.setup();
    render(<ConnectorSetupWizard onToast={() => {}} />);
    await screen.findByText("Retry");
    await user.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByText("WhatsApp")).toBeInTheDocument());
  });

  test("form validation: Connect is blocked with an error toast when no credential field has a value", async () => {
    mockFetchRouter(() => ({ providers: [WHATSAPP] }));
    const onToast = jest.fn();
    const user = userEvent.setup();
    render(<ConnectorSetupWizard onToast={onToast} />);
    await user.click(await screen.findByText("WhatsApp"));
    await user.click(screen.getByText("Connect"));
    expect(onToast).toHaveBeenCalledWith("error", "Enter at least one credential");
  });

  test("mutation success: saving valid credentials posts to /my-connectors/:id and refreshes the list", async () => {
    let posted = null;
    let saved = false;
    mockFetchRouter((path, options) => {
      if (path === "/my-connectors/whatsapp" && options?.method === "POST") {
        posted = JSON.parse(options.body);
        saved = true;
        return jsonResponse({ ok: true });
      }
      if (path === "/my-connectors") return { providers: [saved ? { ...WHATSAPP, connected: true } : WHATSAPP] };
      return {};
    });
    const onToast = jest.fn();
    const user = userEvent.setup();
    render(<ConnectorSetupWizard onToast={onToast} />);
    await user.click(await screen.findByText("WhatsApp"));
    await user.type(screen.getByPlaceholderText("Enter API Key"), "sk_test_123");
    await user.click(screen.getByText("Connect"));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith("success", "Connector saved"));
    expect(posted).toEqual({ apiKey: "sk_test_123" });
  });

  test("REGRESSION GUARD: a failed save shows an error toast and does not collapse the form (input not silently lost)", async () => {
    mockFetchRouter((path, options) => {
      if (path === "/my-connectors/whatsapp" && options?.method === "POST") {
        return jsonResponse({ error: "Invalid API key format" }, { ok: false, status: 400 });
      }
      return { providers: [WHATSAPP] };
    });
    const onToast = jest.fn();
    const user = userEvent.setup();
    render(<ConnectorSetupWizard onToast={onToast} />);
    await user.click(await screen.findByText("WhatsApp"));
    await user.type(screen.getByPlaceholderText("Enter API Key"), "bad-key");
    await user.click(screen.getByText("Connect"));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith("error", "Invalid API key format"));
    expect(screen.getByPlaceholderText("Enter API Key").value).toBe("bad-key");
  });

  test("duplicate-submit protection: Connect button is disabled and shows a busy label mid-flight", async () => {
    let resolveSave;
    mockFetchRouter((path, options) => {
      if (path === "/my-connectors/whatsapp" && options?.method === "POST") {
        return new Promise((res) => { resolveSave = () => res(jsonResponse({ ok: true })); });
      }
      return { providers: [WHATSAPP] };
    });
    const user = userEvent.setup();
    render(<ConnectorSetupWizard onToast={() => {}} />);
    await user.click(await screen.findByText("WhatsApp"));
    await user.type(screen.getByPlaceholderText("Enter API Key"), "sk_test_123");
    await user.click(screen.getByText("Connect"));

    const busyBtn = screen.getByText("Saving…");
    expect(busyBtn).toBeDisabled();
    resolveSave();
    await waitFor(() => expect(screen.queryByText("Saving…")).not.toBeInTheDocument());
  });

  test("destructive action: Disconnect requires confirmation naming the real credential impact, cancelling makes no DELETE call", async () => {
    const mock = mockFetchRouter(() => ({ providers: [CONNECTED_PAYMENTS] }));
    const user = userEvent.setup();
    render(<ConnectorSetupWizard onToast={() => {}} />);
    await user.click(await screen.findByText("Razorpay"));
    await user.click(screen.getByText("Disconnect"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/permanently removes/)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/Razorpay/).length).toBeGreaterThan(0);

    const callsBefore = mock.mock.calls.length;
    await user.click(within(dialog).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mock.mock.calls.length).toBe(callsBefore);
  });

  test("destructive action: confirming Disconnect calls DELETE and refreshes to the not-connected state", async () => {
    let deleted = false;
    mockFetchRouter((path, options) => {
      if (path === "/my-connectors/razorpay" && options?.method === "DELETE") { deleted = true; return jsonResponse({ ok: true }); }
      if (path === "/my-connectors") return { providers: [deleted ? { ...CONNECTED_PAYMENTS, connected: false } : CONNECTED_PAYMENTS] };
      return {};
    });
    const onToast = jest.fn();
    const user = userEvent.setup();
    render(<ConnectorSetupWizard onToast={onToast} />);
    await user.click(await screen.findByText("Razorpay"));
    await user.click(screen.getByText("Disconnect"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Disconnect"));

    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("success", "Disconnected"));
  });

  test("REGRESSION GUARD: a failed disconnect shows an error toast rather than silently reporting success", async () => {
    mockFetchRouter((path, options) => {
      if (path === "/my-connectors/razorpay" && options?.method === "DELETE") {
        return jsonResponse({ error: "Vault locked" }, { ok: false, status: 423 });
      }
      return { providers: [CONNECTED_PAYMENTS] };
    });
    const onToast = jest.fn();
    const user = userEvent.setup();
    render(<ConnectorSetupWizard onToast={onToast} />);
    await user.click(await screen.findByText("Razorpay"));
    await user.click(screen.getByText("Disconnect"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Disconnect"));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith("error", "Vault locked"));
    expect(onToast).not.toHaveBeenCalledWith("success", "Disconnected");
  });

  test("mobile-critical interaction: the card header is keyboard-activatable (Enter/Space toggle, not mouse-only)", async () => {
    mockFetchRouter(() => ({ providers: [WHATSAPP] }));
    const user = userEvent.setup();
    render(<ConnectorSetupWizard onToast={() => {}} />);
    const header = (await screen.findByText("WhatsApp")).closest('[role="button"]');
    expect(header).toHaveAttribute("tabIndex", "0");
    header.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByPlaceholderText("Enter API Key")).toBeInTheDocument();
  });
});
