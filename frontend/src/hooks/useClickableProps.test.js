import { clickableProps, overlayProps } from "./useClickableProps";

// clickableProps is the shared primitive behind every custom row/card/pin
// control in the app (MoreMenu's pin button, plugin cards, etc.) — it's what
// makes a <div onClick> behave like a real control for keyboard users and,
// on touch devices, for anything relying on focus/activation semantics
// rather than raw pointer events. A regression here silently breaks
// accessibility and touch-equivalent activation across the whole app at once.

describe("clickableProps — shared activation primitive (categories 12 & keyboard nav)", () => {
  test("returns button semantics with a natural tab stop by default", () => {
    const props = clickableProps(() => {});
    expect(props.role).toBe("button");
    expect(props.tabIndex).toBe(0);
  });

  test("onClick fires the handler", () => {
    const onClick = jest.fn();
    const props = clickableProps(onClick);
    const event = {};
    props.onClick(event);
    expect(onClick).toHaveBeenCalledWith(event);
  });

  test("Enter key activates the handler and preventDefaults", () => {
    const onClick = jest.fn();
    const props = clickableProps(onClick);
    const target = {};
    const event = { key: "Enter", target, currentTarget: target, preventDefault: jest.fn() };
    props.onKeyDown(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledWith(event);
  });

  test("Space key activates the handler and preventDefaults (stops page scroll)", () => {
    const onClick = jest.fn();
    const props = clickableProps(onClick);
    const target = {};
    const event = { key: " ", target, currentTarget: target, preventDefault: jest.fn() };
    props.onKeyDown(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledWith(event);
  });

  test("other keys (e.g. Tab, Escape) do not activate the handler", () => {
    const onClick = jest.fn();
    const props = clickableProps(onClick);
    const target = {};
    props.onKeyDown({ key: "Tab", target, currentTarget: target, preventDefault: jest.fn() });
    expect(onClick).not.toHaveBeenCalled();
  });

  test("a key event bubbling up from a nested real control (button/input) is ignored, not double-fired", () => {
    const onClick = jest.fn();
    const props = clickableProps(onClick);
    const outer = {};
    const nestedButton = { tagName: "BUTTON" };
    props.onKeyDown({ key: "Enter", target: nestedButton, currentTarget: outer, preventDefault: jest.fn() });
    expect(onClick).not.toHaveBeenCalled();
  });

  test("disabled: no click/keydown handlers, aria-disabled, removed from tab order", () => {
    const onClick = jest.fn();
    const props = clickableProps(onClick, { disabled: true });
    expect(props["aria-disabled"]).toBe(true);
    expect(props.tabIndex).toBe(-1);
    expect(props.onClick).toBeUndefined();
    expect(props.onKeyDown).toBeUndefined();
  });

  test("label option sets aria-label for both enabled and disabled variants", () => {
    expect(clickableProps(() => {}, { label: "Pin item" })["aria-label"]).toBe("Pin item");
    expect(clickableProps(() => {}, { disabled: true, label: "Pin item" })["aria-label"]).toBe("Pin item");
  });

  test("stopPropagation option stops the event before invoking the handler", () => {
    const onClick = jest.fn();
    const props = clickableProps(onClick, { stopPropagation: true });
    const event = { stopPropagation: jest.fn() };
    props.onClick(event);
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledWith(event);
  });
});

describe("overlayProps — backdrop dismissal", () => {
  test("dismisses only when the backdrop itself (not a nested child) is the click target", () => {
    const onDismiss = jest.fn();
    const props = overlayProps(onDismiss);
    const backdrop = {};
    props.onClick({ target: backdrop, currentTarget: backdrop });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test("does not dismiss when a nested child inside the overlay was clicked", () => {
    const onDismiss = jest.fn();
    const props = overlayProps(onDismiss);
    props.onClick({ target: {}, currentTarget: {} });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
