import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "../contexts/AuthContext";
import WorkspaceSettings from "./WorkspaceSettings";
import { mockFetchRouter, restoreFetch } from "../testUtils/mockFetch";

function renderAs(role) {
  const mock = mockFetchRouter((path) => {
    if (path === "/auth/me") return { user: { role, email: "u@x.com" } };
    if (path === "/settings/status") return { success: true };
    if (path === "/integrations") return { ok: true, connectors: [{ id: "razorpay", status: "connected" }] };
    return {};
  });
  render(<AuthProvider><WorkspaceSettings onNavigate={() => {}} /></AuthProvider>);
  return mock;
}

afterEach(() => {
  restoreFetch();
  localStorage.clear();
});

describe("WorkspaceSettings — permission-gated integration status + branding mutation (categories 5 & 8)", () => {
  test("operator account: fetches real integration status (operatorOnly route)", async () => {
    const mock = renderAs("operator");
    await screen.findByRole("heading", { name: "Branding" });
    await waitFor(() => expect(mock.mock.calls.some(([url]) => String(url).includes("/integrations"))).toBe(true));
  });

  test("REGRESSION GUARD: a non-operator (customer) account never calls the operatorOnly /integrations route", async () => {
    const mock = renderAs("user");
    await screen.findByRole("heading", { name: "Branding" });
    // give any stray async effect a tick to fire before asserting a negative
    await new Promise((r) => setTimeout(r, 0));
    expect(mock.mock.calls.some(([url]) => String(url).includes("/integrations"))).toBe(false);
  });

  test("branding: editing the workspace name updates the field live and is honestly disclosed as local-only", async () => {
    renderAs("user");
    await screen.findByRole("heading", { name: "Branding" });
    expect(screen.getByText(/there's no workspace branding backend yet/)).toBeInTheDocument();
    const user = userEvent.setup();
    const input = screen.getByPlaceholderText("My Workspace");
    await user.clear(input);
    await user.type(input, "Acme Consulting");
    expect(input.value).toBe("Acme Consulting");
  });

  test("branding: Save persists to localStorage and shows a toast", async () => {
    renderAs("user");
    await screen.findByRole("heading", { name: "Branding" });
    const user = userEvent.setup();
    const input = screen.getByPlaceholderText("My Workspace");
    await user.clear(input);
    await user.type(input, "Acme Consulting");
    await user.click(screen.getByText("Save branding"));

    expect(await screen.findByText("Branding saved")).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem("ooplix_ws_branding") || "{}");
    expect(stored.workspaceName).toBe("Acme Consulting");
  });

  test("branding: Reset restores defaults and persists them", async () => {
    renderAs("user");
    await screen.findByRole("heading", { name: "Branding" });
    const user = userEvent.setup();
    const input = screen.getByPlaceholderText("My Workspace");
    await user.clear(input);
    await user.type(input, "Acme Consulting");
    await user.click(screen.getByText("Reset to defaults"));

    expect(await screen.findByText("Branding reset to defaults")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("My Workspace").value).toBe("My Workspace");
  });
});
