import React from "react";
import { render, screen } from "@testing-library/react";
import { TabObservability, TabTelemetry } from "./DevOpsCenterV2";
import { mockFetchRouter, restoreFetch } from "../testUtils/mockFetch";

afterEach(() => restoreFetch());

describe("DevOpsCenterV2 fake-data disclosure — Dependency Map and Endpoint Latency", () => {
  test("REGRESSION GUARD: Dependency Map (100% hardcoded DEPS, no live source) is now disclosed as illustrative", async () => {
    mockFetchRouter((path) => {
      if (path === "/p25/obs/slos") return { slos: [] };
      if (path === "/p25/obs/servicemap") return { services: [] };
      return {};
    });
    render(<TabObservability addToast={() => {}} />);
    expect(await screen.findByText("Dependency Map")).toBeInTheDocument();
    expect(await screen.findByText(/illustrative dependency topology/)).toBeInTheDocument();
  });

  test("REGRESSION GUARD: Endpoint Latency (4/5 rows permanently hardcoded PERF_EPS) is now disclosed as illustrative", async () => {
    mockFetchRouter((path) => {
      if (path === "/ops") return { uptime: 100, pid: 123, port: 5050 };
      if (path === "/metrics") return { avg_response_ms: 210, total_requests: 500, p95_ms: 400 };
      if (path.startsWith("/p25/obs/metrics")) return { memory_mb: 300 };
      return {};
    });
    render(<TabTelemetry addToast={() => {}} />);
    expect(await screen.findByText("Endpoint Latency (avg)")).toBeInTheDocument();
    expect(await screen.findByText(/illustrative endpoint latency/)).toBeInTheDocument();
  });
});
