import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabDLQ } from "./DevOpsCenterV2";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

const ENTRY = { taskId: "t1", input: "send-email", attempts: 3, failedAt: new Date().toISOString(), error: "SMTP timeout" };

afterEach(() => restoreFetch());

describe("DevOpsCenterV2 TabDLQ — dead letter queue recovery (failed-task safety net)", () => {
  test("genuinely empty queue shows the honest all-clear state", async () => {
    mockFetchRouter(() => ({ success: true, entries: [], total: 0 }));
    render(<TabDLQ addToast={() => {}} />);
    expect(await screen.findByText("Dead letter queue is empty")).toBeInTheDocument();
  });

  test("real entries render with their failure detail", async () => {
    mockFetchRouter(() => ({ success: true, entries: [ENTRY], total: 1 }));
    render(<TabDLQ addToast={() => {}} />);
    expect(await screen.findByText("send-email")).toBeInTheDocument();
    expect(screen.getByText("SMTP timeout")).toBeInTheDocument();
  });

  test("REGRESSION GUARD (P1 fix): an API failure shows a distinct error state, never the reassuring 'queue is empty' checkmark", async () => {
    mockFetchRouter(() => jsonResponse({ error: "Backend unreachable" }, { ok: false, status: 500 }));
    render(<TabDLQ addToast={() => {}} />);
    expect(await screen.findByText("Couldn't load the recovery queue")).toBeInTheDocument();
    expect(screen.getByText("Backend unreachable")).toBeInTheDocument();
    expect(screen.queryByText("Dead letter queue is empty")).not.toBeInTheDocument();
  });

  test("Retry after a failed load recovers to the real queue", async () => {
    let attempt = 0;
    mockFetchRouter(() => {
      attempt += 1;
      return attempt === 1 ? jsonResponse({ error: "timeout" }, { ok: false, status: 504 }) : { success: true, entries: [ENTRY], total: 1 };
    });
    const user = userEvent.setup();
    render(<TabDLQ addToast={() => {}} />);
    await screen.findByText("Retry");
    await user.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByText("send-email")).toBeInTheDocument());
  });

  test("Requeue all calls the real recovery endpoint and refreshes", async () => {
    let recovered = false;
    const onToast = jest.fn();
    mockFetchRouter((path, options) => {
      if (path === "/runtime/recover/dlq" && options?.method === "POST") { recovered = true; return { success: true, queued: 1 }; }
      return { success: true, entries: recovered ? [] : [ENTRY], total: recovered ? 0 : 1 };
    });
    const user = userEvent.setup();
    render(<TabDLQ addToast={onToast} />);
    await screen.findByText("send-email");
    await user.click(screen.getByText(/Requeue all/));

    await waitFor(() => expect(recovered).toBe(true));
    expect(onToast).toHaveBeenCalledWith("Requeued 1 task(s)", "success");
  });

  test("REGRESSION GUARD: a failed Requeue all shows an error toast, not a silent success", async () => {
    const onToast = jest.fn();
    mockFetchRouter((path, options) => {
      if (path === "/runtime/recover/dlq" && options?.method === "POST") {
        return jsonResponse({ error: "Queue processor busy" }, { ok: false, status: 503 });
      }
      return { success: true, entries: [ENTRY], total: 1 };
    });
    const user = userEvent.setup();
    render(<TabDLQ addToast={onToast} />);
    await screen.findByText("send-email");
    await user.click(screen.getByText(/Requeue all/));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining("Recovery failed"), "error"));
    expect(screen.getByText("send-email")).toBeInTheDocument(); // entry stays — real failure, not silently cleared
  });

  test("duplicate-submit protection: Requeue all is disabled mid-flight", async () => {
    let resolveRecover;
    mockFetchRouter((path, options) => {
      if (path === "/runtime/recover/dlq" && options?.method === "POST") {
        return new Promise((res) => { resolveRecover = () => res(jsonResponse({ success: true, queued: 1 })); });
      }
      return { success: true, entries: [ENTRY], total: 1 };
    });
    const user = userEvent.setup();
    render(<TabDLQ addToast={() => {}} />);
    await screen.findByText("send-email");
    await user.click(screen.getByText(/Requeue all/));

    const busyBtn = screen.getByText("Requeuing…");
    expect(busyBtn).toBeDisabled();
    resolveRecover();
    await waitFor(() => expect(screen.queryByText("Requeuing…")).not.toBeInTheDocument());
  });

  test("Discard removes a single entry via the real DELETE endpoint", async () => {
    let deleted = false;
    mockFetchRouter((path, options) => {
      if (path === "/runtime/dead-letter/t1" && options?.method === "DELETE") { deleted = true; return { success: true }; }
      return { success: true, entries: [ENTRY], total: 1 };
    });
    const user = userEvent.setup();
    render(<TabDLQ addToast={() => {}} />);
    await screen.findByText("send-email");
    await user.click(screen.getByText("✕ Discard"));

    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(screen.queryByText("send-email")).not.toBeInTheDocument());
  });
});
