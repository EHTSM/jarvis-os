import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LinkGenerator } from "./PaymentsV2";
import { mockFetchRouter, restoreFetch, jsonResponse } from "../testUtils/mockFetch";

afterEach(() => {
  restoreFetch();
  jest.restoreAllMocks();
});

describe("PaymentsV2 LinkGenerator — revenue-critical payment link mutation", () => {
  test("blocks generation with no network call when amount is missing/non-numeric", async () => {
    const mock = mockFetchRouter(() => ({}));
    const user = userEvent.setup();
    render(<LinkGenerator leads={[]} onLinkCreated={() => {}} />);
    await user.type(screen.getByPlaceholderText("Website redesign — 50% advance"), "Consulting");
    await user.click(screen.getByText("Generate Link →"));
    expect(await screen.findByText("Enter a valid amount.")).toBeInTheDocument();
    expect(mock).not.toHaveBeenCalled();
  });

  test("successful generation shows the link, clears the form, and notifies the parent", async () => {
    mockFetchRouter((path, options) => {
      expect(path).toBe("/payment/link");
      expect(JSON.parse(options.body)).toMatchObject({ amount: "15000" });
      return { success: true, link: "https://pay.example/xyz" };
    });
    const onLinkCreated = jest.fn();
    const user = userEvent.setup();
    render(<LinkGenerator leads={[]} onLinkCreated={onLinkCreated} />);
    await user.type(screen.getByPlaceholderText("15000"), "15000");
    await user.click(screen.getByText("Generate Link →"));

    expect(await screen.findByText("https://pay.example/xyz")).toBeInTheDocument();
    expect(onLinkCreated).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText("15000").value).toBe(""); // form reset on success
  });

  test("Razorpay-not-configured error shows the setup guide, not a generic failure message", async () => {
    mockFetchRouter(() => ({ success: false, error: "Razorpay key not configured" }));
    const user = userEvent.setup();
    render(<LinkGenerator leads={[]} onLinkCreated={() => {}} />);
    await user.type(screen.getByPlaceholderText("15000"), "15000");
    await user.click(screen.getByText("Generate Link →"));

    expect(await screen.findByText("Payments not configured — see setup guide below.")).toBeInTheDocument();
  });

  test("REGRESSION GUARD: a generic backend failure shows the real error and preserves the amount/description the user typed", async () => {
    mockFetchRouter(() => jsonResponse({ error: "Gateway timeout" }, { ok: false, status: 504 }));
    const user = userEvent.setup();
    render(<LinkGenerator leads={[]} onLinkCreated={() => {}} />);
    await user.type(screen.getByPlaceholderText("15000"), "15000");
    await user.type(screen.getByPlaceholderText("Website redesign — 50% advance"), "50% advance");
    await user.click(screen.getByText("Generate Link →"));

    expect(await screen.findByText("Gateway timeout")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("15000").value).toBe("15000");
    expect(screen.getByPlaceholderText("Website redesign — 50% advance").value).toBe("50% advance");
  });

  test("duplicate-submit protection: Generate button is disabled and shows a busy label mid-flight", async () => {
    let resolveFetch;
    mockFetchRouter(() => new Promise((res) => { resolveFetch = () => res(jsonResponse({ success: true, link: "https://pay.example/x" })); }));
    const user = userEvent.setup();
    render(<LinkGenerator leads={[]} onLinkCreated={() => {}} />);
    await user.type(screen.getByPlaceholderText("15000"), "15000");
    await user.click(screen.getByText("Generate Link →"));

    const busyBtn = screen.getByText("Generating…");
    expect(busyBtn).toBeDisabled();
    resolveFetch();
    await waitFor(() => expect(screen.queryByText("Generating…")).not.toBeInTheDocument());
  });

  test("selecting a contact from search prefills name/phone", async () => {
    mockFetchRouter(() => ({}));
    const leads = [{ name: "Priya Sharma", phone: "919876543210" }];
    const user = userEvent.setup();
    render(<LinkGenerator leads={leads} onLinkCreated={() => {}} />);
    await user.type(screen.getByPlaceholderText("Search contacts…"), "Priya");
    await user.click(await screen.findByText("Priya Sharma"));
    expect(screen.getByText(/Priya Sharma.*919876543210/)).toBeInTheDocument();
  });
});
