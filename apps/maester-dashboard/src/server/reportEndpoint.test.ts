import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  concept: vi.fn(),
  approve: vi.fn(),
  download: vi.fn(),
  status: vi.fn(),
}));
vi.mock("./dashboard", () => ({
  authorizePilot: vi.fn((user, config) => {
    if (!user || user.id !== config.PILOT_USER_ID) throw new Error("denied");
  }),
}));
vi.mock("./approval", () => ({
  createConcept: mocks.concept,
  approveConcept: mocks.approve,
  downloadReport: mocks.download,
  reportStatus: mocks.status,
}));
const { handleReportRequest } = await import("./reportEndpoint");
const user = {
  id: "pilot",
  email: "mvanfalier@atura.nl",
  orgId: "org",
  channel: "web",
  actor: { sub: "pilot" },
};
const env = {
  PILOT_USER_ID: "pilot",
  PILOT_ORG_ID: "org",
  REPORTS: {} as R2Bucket,
};
const request = (method: string, path: string, options: RequestInit = {}) =>
  new Request(`https://app.example${path}`, { method, ...options });
describe("report HTTP perimeter", () => {
  it("rejects unsigned identity and cross-site writes before business logic", async () => {
    mocks.concept.mockClear();
    expect(
      (
        await handleReportRequest(
          request("GET", "/api/reports?tenant=tenant&run=run"),
          env,
          null,
        )
      )?.status,
    ).toBe(401);
    expect(
      (
        await handleReportRequest(
          request("POST", "/api/reports?tenant=tenant&run=run", {
            headers: { origin: "https://evil.example" },
          }),
          env,
          user,
        )
      )?.status,
    ).toBe(403);
    expect(mocks.concept).not.toHaveBeenCalled();
  });
  it("requires same-origin explicit POST for concept and approval, and attachment GET", async () => {
    mocks.concept.mockResolvedValue({
      digest: "a".repeat(64),
      status: "concept",
    });
    mocks.approve.mockResolvedValue({
      digest: "a".repeat(64),
      status: "approved",
    });
    mocks.download.mockResolvedValue(
      new Response("%PDF-", {
        headers: { "content-disposition": "attachment" },
      }),
    );
    const path = "/api/reports?tenant=tenant&run=run";
    expect(
      (
        await handleReportRequest(
          request("POST", path, {
            headers: {
              origin: "https://app.example",
              "content-type": "application/json",
            },
            body: '{"action":"concept"}',
          }),
          env,
          user,
        )
      )?.status,
    ).toBe(200);
    expect(mocks.concept).toHaveBeenCalled();
    expect(
      (
        await handleReportRequest(
          request("POST", path, {
            headers: {
              origin: "https://app.example",
              "content-type": "application/json",
            },
            body: JSON.stringify({ action: "approve", digest: "a".repeat(64) }),
          }),
          env,
          user,
        )
      )?.status,
    ).toBe(200);
    expect(mocks.approve).toHaveBeenCalled();
    expect(
      (
        await handleReportRequest(
          request("GET", `${path}&digest=${"a".repeat(64)}`),
          env,
          user,
        )
      )?.headers.get("content-disposition"),
    ).toBe("attachment");
  });
});
