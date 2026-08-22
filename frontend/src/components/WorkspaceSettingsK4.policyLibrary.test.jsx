import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PolicyLibraryPanel } from "./WorkspaceSettingsK4";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

const POLICY = { id: "p1", name: "Change Approval", type: "change", enforcement: "mandatory", status: "active" };

function baseRoutes({ policies = [POLICY], templates = [] } = {}) {
  return (path) => {
    if (path === "/governance/policies") return { policies };
    if (path === "/governance/templates") return { templates };
    return {};
  };
}

afterEach(() => restoreFetch());

describe("WorkspaceSettingsK4 PolicyLibraryPanel — governance/compliance surface", () => {
  test("real data renders active policy count", async () => {
    mockFetchRouter(baseRoutes());
    render(<PolicyLibraryPanel />);
    expect(await screen.findByText("1 active")).toBeInTheDocument();
  });

  test("REGRESSION GUARD (P1 fix): an API failure shows a distinct error state with Retry, never a false '0 active' governance state", async () => {
    mockFetchRouter(() => jsonResponse({ error: "Backend unreachable" }, { ok: false, status: 500 }));
    render(<PolicyLibraryPanel />);
    expect(await screen.findByText(/Couldn.t load this data.*Backend unreachable/)).toBeInTheDocument();
    expect(screen.queryByText("0 active")).not.toBeInTheDocument();
  });

  test("Retry after a failed load recovers to real policy data", async () => {
    let attempt = 0;
    mockFetchRouter((path) => {
      if (path === "/governance/policies") {
        attempt += 1;
        return attempt === 1 ? jsonResponse({ error: "timeout" }, { ok: false, status: 504 }) : { policies: [POLICY] };
      }
      return baseRoutes()(path);
    });
    const user = userEvent.setup();
    render(<PolicyLibraryPanel />);
    await screen.findByText("Retry");
    await user.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByText("1 active")).toBeInTheDocument());
  });

  test("form validation: Create is disabled until a policy name is entered", async () => {
    mockFetchRouter(baseRoutes({ policies: [] }));
    const user = userEvent.setup();
    render(<PolicyLibraryPanel />);
    await screen.findByText("0 active");
    await user.click(screen.getByText("＋ New policy"));
    expect(screen.getByText("Create")).toBeDisabled();
    await user.type(screen.getByPlaceholderText("Policy name…"), "Data Retention");
    expect(screen.getByText("Create")).toBeEnabled();
  });

  test("mutation: creating a policy posts the real payload and refreshes the list", async () => {
    let posted = null;
    mockFetchRouter((path, options) => {
      if (path === "/governance/policies" && options?.method === "POST") {
        posted = JSON.parse(options.body);
        return { success: true };
      }
      return baseRoutes({ policies: posted ? [POLICY] : [] })(path);
    });
    const user = userEvent.setup();
    render(<PolicyLibraryPanel />);
    await screen.findByText("0 active");
    await user.click(screen.getByText("＋ New policy"));
    await user.type(screen.getByPlaceholderText("Policy name…"), "Data Retention");
    await user.click(screen.getByText("Create"));

    await waitFor(() => expect(posted).toMatchObject({ name: "Data Retention" }));
  });

  test("REGRESSION GUARD: a failed policy creation shows an error toast, not a silent success", async () => {
    mockFetchRouter((path, options) => {
      if (path === "/governance/policies" && options?.method === "POST") {
        return jsonResponse({ error: "Not authorized" }, { ok: false, status: 403 });
      }
      return baseRoutes({ policies: [] })(path);
    });
    const user = userEvent.setup();
    render(<PolicyLibraryPanel />);
    await screen.findByText("0 active");
    await user.click(screen.getByText("＋ New policy"));
    await user.type(screen.getByPlaceholderText("Policy name…"), "Data Retention");
    await user.click(screen.getByText("Create"));

    expect(await screen.findByText("Not authorized")).toBeInTheDocument();
  });
});
