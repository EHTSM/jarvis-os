"use strict";
/**
 * Mission 58 — regression test: BottomNav hides the Insights tab
 * (operator-only /stats and /ops backing routes — Mission 55/56 findings)
 * for non-operator accounts, and shows it for operators.
 *
 * Uses only react-dom + react-dom/test-utils (already real dependencies),
 * matching Mission 56's Dashboard.forbidden.test.jsx approach — no new
 * package (@testing-library/react is not installed in mobile/).
 * useAuth() is mocked (jest.mock) rather than exporting AuthContext just
 * for testability — no source change needed.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { MemoryRouter } from "react-router-dom";
import BottomNav from "./BottomNav.jsx";

let mockRole = null;
jest.mock("../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { uid: "test" }, role: mockRole, sessionError: null }),
}));

// eslint-disable-next-line no-undef
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  document.body.removeChild(container);
  container = null;
});

async function renderWithRole(role) {
  mockRole = role;
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <BottomNav />
      </MemoryRouter>
    );
  });
  return container;
}

describe("BottomNav — role-aware Insights tab gating", () => {
  test("REGRESSION GUARD: a non-operator (role='user') account does NOT see the Insights tab", async () => {
    const el = await renderWithRole("user");
    expect(el.textContent).not.toContain("Insights");
    expect(el.textContent).toContain("Home");
    expect(el.textContent).toContain("Tools");
    expect(el.textContent).toContain("Profile");
  });

  test("an operator account DOES see the Insights tab", async () => {
    const el = await renderWithRole("operator");
    expect(el.textContent).toContain("Insights");
  });

  test("a null/unresolved role (session still loading) does NOT show Insights — fails closed, not open", async () => {
    const el = await renderWithRole(null);
    expect(el.textContent).not.toContain("Insights");
  });
});
