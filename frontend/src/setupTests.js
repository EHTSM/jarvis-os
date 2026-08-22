import '@testing-library/jest-dom';

// jsdom's test environment doesn't expose TextEncoder/TextDecoder globally
// even though Node provides them — firebase/auth's Node build needs them at
// import time, and App.jsx transitively imports firebaseService.js.
if (typeof global.TextEncoder === "undefined") {
  const { TextEncoder, TextDecoder } = require("util");
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

// jsdom (the test environment bundled with this react-scripts version) has no
// BroadcastChannel implementation. AuthContext relies on it for multi-tab auth
// sync, so a minimal in-process polyfill lets that behavior be exercised in
// tests rather than silently skipped.
if (typeof global.BroadcastChannel === "undefined") {
  const channels = new Map();
  class BroadcastChannelPolyfill {
    constructor(name) {
      this.name = name;
      this._listeners = new Set();
      if (!channels.has(name)) channels.set(name, new Set());
      channels.get(name).add(this);
    }
    postMessage(data) {
      for (const peer of channels.get(this.name) || []) {
        if (peer === this) continue;
        for (const fn of peer._listeners) fn({ data });
      }
    }
    addEventListener(_type, fn) { this._listeners.add(fn); }
    removeEventListener(_type, fn) { this._listeners.delete(fn); }
    close() { channels.get(this.name)?.delete(this); }
  }
  global.BroadcastChannel = BroadcastChannelPolyfill;
}

// jsdom has no EventSource implementation either. CommandCenter's
// LiveActivityStream opens a real SSE connection on mount — this inert
// polyfill lets components that construct one mount without crashing;
// tests exercising SSE message handling would need to drive it explicitly
// via the instance's onmessage/onerror, which none currently do.
if (typeof global.EventSource === "undefined") {
  class EventSourcePolyfill {
    constructor(url) { this.url = url; this.onmessage = null; this.onerror = null; }
    close() {}
  }
  global.EventSource = EventSourcePolyfill;
}
