import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "../../components/ui";
import { jobsApi } from "../../lib/api/resources";
import type { Job } from "../../lib/api/types";
import { BusinessProvider } from "../businesses/business-context";
import { JobsPage, truncateError } from "./JobsPage";

const businessId = "30292e18-abfd-43c1-946d-8e18489a39a5";
const failedJob: Job = {
  jobId: "0112b819-6653-4234-821a-6a2fce393c3f",
  jobType: "fulfillment_dispatch",
  status: "failed",
  attempts: 3,
  maxAttempts: 5,
  runAt: "2026-09-01T10:00:00.000Z",
  lastError: "Error persistente del proveedor ".repeat(10).trim(),
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

function renderJobs(role: "owner" | "operator" = "owner") {
  const client = new QueryClient({ defaultOptions: {
    queries: { retry: false }, mutations: { retry: false },
  } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}><ToastProvider>
      <BusinessProvider business={{ id: businessId, name: "Flowchat DEV", currency: "CLP", status: "active", role }}>
        <JobsPage />
      </BusinessProvider>
    </ToastProvider></QueryClientProvider>,
  );
  return { invalidate };
}

test("lists failed jobs by default, including attempts, schedule and truncated error", async () => {
  const list = vi.spyOn(jobsApi, "list").mockResolvedValue([failedJob]);
  renderJobs();

  expect(await screen.findByText("fulfillment_dispatch")).toBeInTheDocument();
  expect(screen.getByText("3/5")).toBeInTheDocument();
  expect(screen.getByText("failed")).toBeInTheDocument();
  expect(list).toHaveBeenCalledWith(businessId, expect.objectContaining({
    status: "failed", limit: 25, offset: 0,
  }));
  expect(screen.getByTitle(failedJob.lastError!)).toBeInTheDocument();
  expect(screen.getByText(truncateError(failedJob.lastError))).toBeInTheDocument();
  expect(truncateError(failedJob.lastError).endsWith("…")).toBe(true);
});

test("refetches the list when the status filter changes", async () => {
  const list = vi.spyOn(jobsApi, "list").mockResolvedValue([failedJob]);
  renderJobs();
  await screen.findByText("fulfillment_dispatch");

  await userEvent.selectOptions(screen.getByLabelText("Estado"), "completed");

  await waitFor(() => expect(list).toHaveBeenCalledWith(businessId, expect.objectContaining({
    status: "completed", offset: 0,
  })));
});

test("lets an owner retry a job and invalidates the jobs query", async () => {
  vi.spyOn(jobsApi, "list").mockResolvedValue([failedJob]);
  const retry = vi.spyOn(jobsApi, "retry").mockResolvedValue({ ...failedJob, status: "pending", attempts: 0 });
  const { invalidate } = renderJobs("owner");

  await userEvent.click(await screen.findByRole("button", { name: "Reintentar" }));

  await waitFor(() => expect(retry).toHaveBeenCalledWith(businessId, failedJob.jobId));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["jobs", businessId] }));
});

test("hides the retry action from operators", async () => {
  vi.spyOn(jobsApi, "list").mockResolvedValue([failedJob]);
  renderJobs("operator");

  expect(await screen.findByText("fulfillment_dispatch")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
});
