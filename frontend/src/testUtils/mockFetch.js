// Shared fetch-mocking helper for tests against `_fetch` in _client.js.
// `_fetch` always calls global `fetch(BASE_URL + path, opts)` and expects
// a Response-shaped object (`.ok`, `.status`, `.json()`).

export function jsonResponse(body, { ok = true, status = ok ? 200 : 500 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

// Installs a `global.fetch` mock driven by a router: (path, options) => responseBody | Response-like.
// Returns the jest mock so callers can assert on call args, and a restore function.
export function mockFetchRouter(router) {
  const mock = jest.fn(async (url, options) => {
    const path = typeof url === "string" ? url.replace(/^https?:\/\/[^/]+/, "") : url;
    const result = await router(path, options);
    if (result && typeof result.ok === "boolean") return result; // already Response-shaped
    return jsonResponse(result);
  });
  global.fetch = mock;
  return mock;
}

export function restoreFetch() {
  delete global.fetch;
};
