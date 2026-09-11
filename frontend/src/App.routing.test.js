// App.jsx transitively imports firebaseService.js -> the real firebase/auth
// Node SDK, which needs Web Streams globals this Jest/jsdom version doesn't
// ship (ReadableStream, MessageChannel, ...). None of that is exercised by
// the pure routing functions under test here, so the module boundary is
// mocked rather than chasing an ever-growing polyfill list.
jest.mock("./firebaseService", () => ({
  isFirebaseConfigured: () => false,
  isElectronShell: () => false,
  onFirebaseAuthState: () => () => {},
  firebaseSignInGoogle: jest.fn(),
  firebaseSignOut: jest.fn(),
}));

import { _initialScreen, _isDesktopShell, _isSaasApp } from "./App";

// _initialScreen reads window.location and localStorage directly, so each
// test sets up the environment it needs and cleans it back up.

function setLocation({ pathname = "/", search = "", hostname = "localhost" } = {}) {
  delete window.location;
  window.location = { pathname, search, hostname };
}

afterEach(() => {
  localStorage.clear();
  setLocation();
});

describe("App routing — navigation and protected routes (category 2)", () => {
  test("emailed password-reset deep link wins over onboarding/auth state", () => {
    setLocation({ pathname: "/reset-password" });
    expect(_initialScreen()).toBe("reset-password");
  });

  test("emailed verify-email deep link wins over onboarding/auth state", () => {
    setLocation({ pathname: "/verify-email" });
    expect(_initialScreen()).toBe("verify-email");
  });

  test("accept-invite deep link wins over onboarding/auth state", () => {
    setLocation({ pathname: "/accept-invite" });
    expect(_initialScreen()).toBe("accept-invite");
  });

  test("deep links win even when onboarding is already complete (no state can hide them)", () => {
    localStorage.setItem("jarvis_started", "1");
    localStorage.setItem("jarvis_biz_profile", JSON.stringify({ biz: "acme" }));
    setLocation({ pathname: "/reset-password" });
    expect(_initialScreen()).toBe("reset-password");
  });

  test("Electron desktop shell (desktop=1) skips landing and onboarding entirely", () => {
    setLocation({ search: "?desktop=1" });
    expect(_isDesktopShell()).toBe(true);
    expect(_initialScreen()).toBe("app");
  });

  test("SaaS domain (app.*) with no onboarding profile routes to onboarding, not landing", () => {
    setLocation({ hostname: "app.ooplix.com" });
    expect(_isSaasApp()).toBe(true);
    expect(_initialScreen()).toBe("onboarding");
  });

  test("SaaS domain with an existing onboarding profile routes straight to app", () => {
    setLocation({ hostname: "app.ooplix.com" });
    localStorage.setItem("jarvis_biz_profile", JSON.stringify({ biz: "acme" }));
    expect(_initialScreen()).toBe("app");
  });

  test("public web, brand-new visitor (no jarvis_started) sees the landing page", () => {
    setLocation({ hostname: "ooplix.com" });
    expect(_initialScreen()).toBe("landing");
  });

  test("public web, started but not onboarded routes to onboarding", () => {
    setLocation({ hostname: "ooplix.com" });
    localStorage.setItem("jarvis_started", "1");
    expect(_initialScreen()).toBe("onboarding");
  });

  test("public web, started AND onboarded routes straight to app", () => {
    setLocation({ hostname: "ooplix.com" });
    localStorage.setItem("jarvis_started", "1");
    localStorage.setItem("jarvis_biz_profile", JSON.stringify({ biz: "acme" }));
    expect(_initialScreen()).toBe("app");
  });
});
