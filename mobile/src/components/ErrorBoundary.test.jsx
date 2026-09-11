"use strict";
/**
 * Mission 58 — regression test: mobile now has an ErrorBoundary (Mission
 * 55 finding: zero crash-reporting/error-boundary coverage). Proves it
 * actually catches a render error and shows real recovery UI instead of a
 * white screen, using only react-dom + react-dom/test-utils (no new
 * package — @testing-library/react is not installed in mobile/).
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import ErrorBoundary from "./ErrorBoundary.jsx";

// eslint-disable-next-line no-undef
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Boom() {
  throw new Error("Simulated render crash");
}

function Fine() {
  return <div>All good</div>;
}

let container;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  document.body.removeChild(container);
  container = null;
});

describe("ErrorBoundary", () => {
  test("REGRESSION GUARD: a render error inside the boundary shows recovery UI, not a white screen/crash", async () => {
    // Suppress React's expected console.error noise for this deliberate throw.
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const root = createRoot(container);
    await act(async () => {
      root.render(<ErrorBoundary label="test screen"><Boom /></ErrorBoundary>);
    });
    spy.mockRestore();

    expect(container.textContent).toContain("Something went wrong");
    expect(container.textContent).toContain("test screen");
    expect(container.textContent).toContain("Simulated render crash");
    expect(container.textContent).toContain("Try again");
  });

  test("negative control: a component that does NOT throw renders normally, boundary is invisible", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<ErrorBoundary label="test screen"><Fine /></ErrorBoundary>);
    });
    expect(container.textContent).toBe("All good");
    expect(container.textContent).not.toContain("Something went wrong");
  });
});
