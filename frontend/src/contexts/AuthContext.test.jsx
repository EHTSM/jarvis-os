import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "./AuthContext";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

// Minimal consumer so we can drive login/logout/refresh through real DOM events
// rather than reaching into the hook internals.
function Probe() {
  const { user, loading, login, logout, sessionExpiring } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="user">{user ? `${user.role}:${user.email || ""}` : "none"}</div>
      <div data-testid="expiring">{String(sessionExpiring)}</div>
      <button onClick={() => login("pw", "a@x.com")}>login</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

function renderWithAuth() {
  return render(<AuthProvider><Probe /></AuthProvider>);
}

beforeEach(() => {
  try {
    localStorage.setItem("jarvis_biz_profile", JSON.stringify({ biz: "acme" }));
    localStorage.setItem("jarvis_has_leads", "1");
    localStorage.setItem("operatorSession", "1");
  } catch {}
});

afterEach(() => {
  restoreFetch();
  localStorage.clear();
  jest.useRealTimers();
});

describe("AuthContext — authentication/session behavior (category 1)", () => {
  test("starts loading, then resolves to logged-out when /auth/me has no user", async () => {
    mockFetchRouter(() => ({ user: null }));
    renderWithAuth();
    expect(screen.getByTestId("loading").textContent).toBe("true");
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("user").textContent).toBe("none");
  });

  test("resolves to logged-in when /auth/me returns a user", async () => {
    mockFetchRouter((path) => {
      if (path === "/auth/me") return { user: { role: "user", email: "a@x.com" } };
      return {};
    });
    renderWithAuth();
    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("user:a@x.com"));
  });

  test("login(password, email) authenticates via loginWithEmail and updates context", async () => {
    mockFetchRouter((path) => {
      if (path === "/auth/me") return { user: null };
      if (path === "/auth/login") return { success: true, role: "user", email: "a@x.com" };
      return {};
    });
    renderWithAuth();
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));

    await act(async () => {
      await userEvent.click(screen.getByText("login"));
    });

    expect(screen.getByTestId("user").textContent).toBe("user:a@x.com");
  });

  test("logout() clears user AND wipes tenant-scoped localStorage (regression guard for the C.7 cross-tenant leak)", async () => {
    mockFetchRouter((path) => {
      if (path === "/auth/me") return { user: { role: "user", email: "a@x.com" } };
      if (path === "/auth/logout") return { success: true };
      return {};
    });
    renderWithAuth();
    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("user:a@x.com"));

    await act(async () => {
      await userEvent.click(screen.getByText("logout"));
    });

    expect(screen.getByTestId("user").textContent).toBe("none");
    // C.7 (C7-01): a prior real bug let a second account on the same browser
    // inherit the first tenant's onboarding profile because logout() didn't
    // clear it. These three keys are the ones AuthContext explicitly wipes.
    expect(localStorage.getItem("jarvis_biz_profile")).toBeNull();
    expect(localStorage.getItem("jarvis_has_leads")).toBeNull();
    expect(localStorage.getItem("operatorSession")).toBeNull();
  });

  test("a global 401 on an authenticated call logs the user out without a hard redirect", async () => {
    let meCallCount = 0;
    mockFetchRouter((path) => {
      if (path === "/auth/me") {
        meCallCount += 1;
        return { user: { role: "user", email: "a@x.com" } };
      }
      if (path === "/personal/knowledge") return jsonResponse({ error: "expired" }, { ok: false, status: 401 });
      return {};
    });

    const { _fetch } = await import("../_client");
    renderWithAuth();
    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("user:a@x.com"));

    // Simulate any authenticated API call 401ing — AuthContext's on401 handler
    // is registered globally and should flip the context to logged-out.
    await act(async () => {
      await _fetch("/personal/knowledge").catch(() => {});
    });

    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("none"));
  });

  test("multi-tab sync: an 'expired' broadcast from another tab logs this tab out too", async () => {
    mockFetchRouter(() => ({ user: { role: "user", email: "a@x.com" } }));
    renderWithAuth();
    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("user:a@x.com"));

    // AuthContext posts to a BroadcastChannel named "jarvis_auth_sync"; simulate
    // a sibling tab's expiry event arriving on our own channel handle.
    const bc = new BroadcastChannel("jarvis_auth_sync");
    await act(async () => {
      bc.postMessage({ event: "expired", user: null });
      await new Promise((r) => setTimeout(r, 0));
    });
    bc.close();

    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("none"));
  });
});
