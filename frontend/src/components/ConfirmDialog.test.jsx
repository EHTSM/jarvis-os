import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useConfirm } from "./ConfirmDialog";

// useConfirm/ConfirmDialog is the app-wide destructive-action confirmation
// primitive — TeamWorkspace member removal, OrgAdminCenter (5 sites), CRM,
// connector Disconnect, and WorkspaceSettingsL1 all replace window.confirm()
// with this. A regression here silently reopens every one of those
// destructive actions to "click and it's just gone."

function Harness({ danger = true }) {
  const [confirm, ConfirmUI] = useConfirm();
  const [result, setResult] = React.useState(null);
  return (
    <div>
      {ConfirmUI}
      <div data-testid="result">{result === null ? "unset" : String(result)}</div>
      <button onClick={async () => setResult(await confirm({
        title: "Remove member?",
        message: "They will immediately lose access.",
        danger,
        confirmLabel: "Remove",
      }))}>
        trigger
      </button>
    </div>
  );
}

describe("useConfirm/ConfirmDialog — destructive-action confirmation (shared, high-leverage)", () => {
  test("no dialog is rendered until confirm() is called", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("clicking the destructive trigger shows the dialog with the given title/message/label", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("trigger"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Remove member?")).toBeInTheDocument();
    expect(screen.getByText("They will immediately lose access.")).toBeInTheDocument();
    expect(screen.getByText("Remove")).toBeInTheDocument();
  });

  test("confirming resolves the awaited promise to true and closes the dialog", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("trigger"));
    await user.click(screen.getByText("Remove"));
    await waitFor(() => expect(screen.getByTestId("result").textContent).toBe("true"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("cancelling resolves the awaited promise to false and closes the dialog — the destructive action must NOT proceed", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("trigger"));
    await user.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.getByTestId("result").textContent).toBe("false"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("Escape key cancels (resolves false) without clicking Cancel", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("trigger"));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByTestId("result").textContent).toBe("false"));
  });

  test("clicking the overlay background (not the dialog box) cancels, same as clicking Cancel", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("trigger"));
    await user.click(screen.getByRole("dialog"));
    await waitFor(() => expect(screen.getByTestId("result").textContent).toBe("false"));
  });
});
