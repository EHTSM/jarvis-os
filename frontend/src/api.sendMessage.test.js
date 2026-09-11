import { sendMessage } from "./api";
import { mockFetchRouter, restoreFetch, jsonResponse } from "./testUtils/mockFetch";

afterEach(() => {
  restoreFetch();
  delete window.electronAPI;
});

describe("sendMessage — critical AI action (category 9)", () => {
  test("rejects empty/whitespace-only input without making a network call", async () => {
    const mock = mockFetchRouter(() => ({}));
    const result = await sendMessage("   ");
    expect(result).toEqual({ success: false, reply: "No input provided." });
    expect(mock).not.toHaveBeenCalled();
  });

  test("posts to /jarvis with input/mode and normalizes a direct {reply} response", async () => {
    const mock = mockFetchRouter((path, options) => {
      expect(path).toBe("/jarvis");
      expect(JSON.parse(options.body)).toMatchObject({ input: "hello", mode: "smart" });
      return { reply: "hi there", success: true };
    });
    const result = await sendMessage("hello");
    expect(result).toMatchObject({ success: true, reply: "hi there" });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  test("normalizes a backend error response (success:false) into a user-facing reply", async () => {
    mockFetchRouter(() => ({ success: false, error: "AI provider unavailable" }));
    const result = await sendMessage("hello");
    expect(result.success).toBe(false);
    expect(result.reply).toBe("AI provider unavailable");
  });

  test("a network/HTTP failure never throws — resolves to a structured failure instead", async () => {
    mockFetchRouter(() => jsonResponse({ error: "Internal error" }, { ok: false, status: 500 }));
    const result = await sendMessage("hello");
    expect(result).toMatchObject({ success: false, reply: "Internal error" });
  });

  test("passes model options through to the request body", async () => {
    const mock = mockFetchRouter((path, options) => {
      expect(JSON.parse(options.body)).toMatchObject({ input: "hello", mode: "smart", model: "gpt-5" });
      return { reply: "ok" };
    });
    await sendMessage("hello", "smart", { model: "gpt-5" });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  test("Electron shell: routes through window.electronAPI.sendCommand instead of fetch", async () => {
    const mock = mockFetchRouter(() => ({}));
    window.electronAPI = { sendCommand: jest.fn().mockResolvedValue({ reply: "from electron", success: true }) };
    const result = await sendMessage("hello");
    expect(window.electronAPI.sendCommand).toHaveBeenCalledWith("hello");
    expect(mock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, reply: "from electron" });
  });

  test("Electron shell: a rejected sendCommand still resolves to a structured failure", async () => {
    window.electronAPI = { sendCommand: jest.fn().mockRejectedValue(new Error("ipc broke")) };
    const result = await sendMessage("hello");
    expect(result.success).toBe(false);
  });
});
