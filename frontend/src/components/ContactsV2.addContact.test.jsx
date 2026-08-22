import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddContactModal } from "./ContactsV2";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

afterEach(() => {
  restoreFetch();
  localStorage.clear();
});

function fillName(user, value) {
  return user.type(screen.getByPlaceholderText("e.g. Priya Sharma"), value);
}
function fillPhone(user, value) {
  return user.type(screen.getByPlaceholderText("919876543210"), value);
}

describe("ContactsV2 AddContactModal — CRM lead capture (revenue-critical form + mutation)", () => {
  test("blocks submit with no network call when name is missing", async () => {
    const mock = mockFetchRouter(() => ({}));
    const user = userEvent.setup();
    render(<AddContactModal onClose={() => {}} onSaved={() => {}} />);
    await fillPhone(user, "919876543210");
    await user.click(screen.getByText("Add Contact →"));
    expect(await screen.findByText("Name is required.")).toBeInTheDocument();
    expect(mock).not.toHaveBeenCalled();
  });

  test("blocks submit with no network call when phone is too short", async () => {
    const mock = mockFetchRouter(() => ({}));
    const user = userEvent.setup();
    render(<AddContactModal onClose={() => {}} onSaved={() => {}} />);
    await fillName(user, "Priya Sharma");
    await fillPhone(user, "123");
    await user.click(screen.getByText("Add Contact →"));
    expect(await screen.findByText(/Enter a valid phone/)).toBeInTheDocument();
    expect(mock).not.toHaveBeenCalled();
  });

  test("valid submit posts to /crm/lead, strips non-digits from phone, and calls onSaved + onClose", async () => {
    let posted = null;
    mockFetchRouter((path, options) => {
      expect(path).toBe("/crm/lead");
      posted = JSON.parse(options.body);
      return { success: true, lead: { name: "Priya Sharma", phone: "919876543210", status: "new" } };
    });
    const onSaved = jest.fn();
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(<AddContactModal onClose={onClose} onSaved={onSaved} />);
    await fillName(user, "Priya Sharma");
    await fillPhone(user, "+91 98765-43210");
    await user.click(screen.getByText("Add Contact →"));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(posted).toMatchObject({ name: "Priya Sharma", phone: "919876543210" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("jarvis_has_leads")).toBe("1");
  });

  test("duplicate lead: shows a specific message and does not call onSaved/onClose", async () => {
    mockFetchRouter(() => ({ success: true, duplicate: true }));
    const onSaved = jest.fn();
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(<AddContactModal onClose={onClose} onSaved={onSaved} />);
    await fillName(user, "Priya Sharma");
    await fillPhone(user, "919876543210");
    await user.click(screen.getByText("Add Contact →"));

    expect(await screen.findByText("This number already exists in your contacts.")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("REGRESSION GUARD: a failed submit shows the error and preserves everything the user typed", async () => {
    mockFetchRouter(() => jsonResponse({ error: "Server unavailable" }, { ok: false, status: 500 }));
    const user = userEvent.setup();
    render(<AddContactModal onClose={() => {}} onSaved={() => {}} />);
    await fillName(user, "Priya Sharma");
    await fillPhone(user, "919876543210");
    await user.type(screen.getByPlaceholderText("Any context about this lead…"), "Met at conference");
    await user.click(screen.getByText("Add Contact →"));

    expect(await screen.findByText("Server unavailable")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. Priya Sharma").value).toBe("Priya Sharma");
    expect(screen.getByPlaceholderText("919876543210").value).toBe("919876543210");
    expect(screen.getByPlaceholderText("Any context about this lead…").value).toBe("Met at conference");
  });

  test("duplicate-submit protection: submit button is disabled and shows a busy label while in flight", async () => {
    let resolveFetch;
    mockFetchRouter(() => new Promise((res) => { resolveFetch = () => res(jsonResponse({ success: true, lead: {} })); }));
    const user = userEvent.setup();
    render(<AddContactModal onClose={() => {}} onSaved={() => {}} />);
    await fillName(user, "Priya Sharma");
    await fillPhone(user, "919876543210");
    await user.click(screen.getByText("Add Contact →"));

    const busyBtn = screen.getByText("Adding…");
    expect(busyBtn).toBeDisabled();
    resolveFetch();
    await waitFor(() => expect(screen.queryByText("Adding…")).not.toBeInTheDocument());
  });
});
