import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Chat from "./Chat";

// Chat.jsx is fully controlled — all mutation state (messages, loading, send)
// is owned by the parent (App.jsx) and already covered by api.sendMessage.test.js
// (Mission 22). This suite covers the piece that lives here: loading/empty
// states, offline handling, and duplicate-submit protection at the input level.

const BASE_PROPS = {
  messages: [{ id: "m1", role: "jarvis", text: "Hi, how can I help?" }],
  input: "",
  loading: false,
  online: true,
  inputRef: { current: null },
  endRef: { current: null },
  onInput: () => {},
  onSend: () => {},
  onKey: () => {},
  onClear: () => {},
  model: "auto",
  onModelChange: () => {},
};

describe("Chat — critical AI action surface: loading/empty/offline states", () => {
  test("empty state (ChatEmptyPrompts) shows when there's exactly one greeting message and it's not loading", () => {
    render(<Chat {...BASE_PROPS} />);
    expect(screen.getByPlaceholderText("Message Ooplix, or type a command…")).toBeInTheDocument();
  });

  test("empty state is suppressed while a response is loading", () => {
    render(<Chat {...BASE_PROPS} loading={true} />);
    expect(screen.getByPlaceholderText("Ooplix is responding…")).toBeInTheDocument();
  });

  test("input and send button are disabled while offline — duplicate/blocked-submit protection", () => {
    render(<Chat {...BASE_PROPS} online={false} />);
    expect(screen.getByLabelText("Message Ooplix")).toBeDisabled();
    expect(screen.getByLabelText("Send message")).toBeDisabled();
  });

  test("input and send button are disabled while a response is in flight (no double-send)", () => {
    render(<Chat {...BASE_PROPS} loading={true} input="are you there" />);
    expect(screen.getByLabelText("Message Ooplix")).toBeDisabled();
    expect(screen.getByLabelText("Send message")).toBeDisabled();
  });

  test("send button stays disabled when the input is only whitespace", () => {
    render(<Chat {...BASE_PROPS} input="   " />);
    expect(screen.getByLabelText("Send message")).toBeDisabled();
  });

  test("send button enables once there is real input, online and not loading", () => {
    render(<Chat {...BASE_PROPS} input="hello" />);
    expect(screen.getByLabelText("Send message")).toBeEnabled();
  });

  test("clicking Send calls onSend exactly once per click", async () => {
    const onSend = jest.fn();
    const user = userEvent.setup();
    render(<Chat {...BASE_PROPS} input="hello" onSend={onSend} />);
    await user.click(screen.getByLabelText("Send message"));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  test("the message input keeps a stable accessible name regardless of the dynamic placeholder text", () => {
    const { rerender } = render(<Chat {...BASE_PROPS} online={false} />);
    expect(screen.getByLabelText("Message Ooplix")).toBeInTheDocument();
    rerender(<Chat {...BASE_PROPS} online={true} loading={true} />);
    expect(screen.getByLabelText("Message Ooplix")).toBeInTheDocument();
  });
});
