import { _fetch, setOn401 } from "./_client";
import { mockFetchRouter, restoreFetch, jsonResponse } from "./testUtils/mockFetch";

afterEach(() => {
  restoreFetch();
  setOn401(null);
  jest.useRealTimers();
});

describe("_fetch — API success/error handling (category 3)", () => {
  test("resolves with parsed JSON on 200", async () => {
    mockFetchRouter(() => ({ success: true, value: 42 }));
    const data = await _fetch("/health");
    expect(data).toEqual({ success: true, value: 42 });
  });

  test("throws an Error carrying the HTTP status on non-2xx", async () => {
    mockFetchRouter(() => jsonResponse({ error: "not found" }, { ok: false, status: 404 }));
    await expect(_fetch("/missing")).rejects.toMatchObject({
      message: "not found",
      status: 404,
    });
  });

  test("falls back to 'HTTP <status>' when the error body has no message", async () => {
    mockFetchRouter(() => jsonResponse({}, { ok: false, status: 503 }));
    await expect(_fetch("/down")).rejects.toMatchObject({ message: "HTTP 503" });
  });

  test("aborts and rejects with a timeout-shaped error past _timeoutMs", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    }));

    const promise = _fetch("/slow", { _timeoutMs: 1000 });
    const assertion = expect(promise).rejects.toThrow("Request timed out");
    jest.advanceTimersByTime(1000);
    await assertion;
  });

  test("401 on an authenticated route fires the global on401 handler", async () => {
    mockFetchRouter(() => jsonResponse({ error: "expired" }, { ok: false, status: 401 }));
    const handler = jest.fn();
    setOn401(handler);
    await expect(_fetch("/personal/knowledge")).rejects.toThrow();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("401 on /auth/login does NOT fire the global on401 handler (bad-password case)", async () => {
    mockFetchRouter(() => jsonResponse({ error: "invalid credentials" }, { ok: false, status: 401 }));
    const handler = jest.fn();
    setOn401(handler);
    await expect(_fetch("/auth/login")).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  test("sends credentials: include on every request (session cookie)", async () => {
    const mock = mockFetchRouter(() => ({ success: true }));
    await _fetch("/health");
    expect(mock).toHaveBeenCalledWith(
      expect.stringContaining("/health"),
      expect.objectContaining({ credentials: "include" }),
    );
  });
});
