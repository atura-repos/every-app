import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  member: {},
  errors: {},
  service: {
    listLinks: vi.fn(),
    createLink: vi.fn(),
    updateLink: vi.fn(),
    deleteLink: vi.fn(),
    getPreferences: vi.fn(),
    savePreferences: vi.fn(),
    importPreferences: vi.fn(),
  },
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b: Record<string, unknown> = {};
    b.middleware = (m: unknown[]) => {
      b.gates = m;
      return b;
    };
    b.validator = (v: (data: unknown) => unknown) => {
      b.validate = v;
      return b;
    };
    b.handler = (h: unknown) => {
      b.run = h;
      return b;
    };
    return b;
  },
}));
vi.mock("@/middleware/auth", () => ({
  organizationMemberMiddleware: mocks.member,
}));
vi.mock("@/middleware/publicError", () => ({
  publicErrorMiddleware: mocks.errors,
}));
vi.mock("@/server/services/PersonalPortalService", () => ({
  PersonalPortalService: mocks.service,
}));
import {
  listPersonalLinks,
  createPersonalLink,
  updatePersonalLink,
  deletePersonalLink,
  getPortalPreferences,
  savePortalPreferences,
  importPortalPreferences,
} from "./personalPortal";
const asFn = (fn: unknown) =>
  fn as {
    gates: unknown[];
    validate: (data: unknown) => unknown;
    run: (args: {
      context: { org: { orgId: string; userId: string } };
      data?: unknown;
    }) => Promise<unknown>;
  };
const context = { org: { orgId: "org-a", userId: "alice" } };
describe("personal portal server boundary", () => {
  it("refuses legacy imports when the expected identity differs from the session", async () => {
    const fn = asFn(importPortalPreferences);
    const data = fn.validate({
      expectedUserId: "alice",
      expectedOrgId: "org-a",
      preferences: { pinnedIds: ["a"], orderedIds: [], layout: "grid" },
    });
    await expect(
      fn.run({ context: { org: { orgId: "org-b", userId: "bob" } }, data }),
    ).rejects.toThrow();
    expect(mocks.service.importPreferences).not.toHaveBeenCalled();
  });
  it("requires both expected identity fields for legacy imports", () => {
    expect(() =>
      asFn(importPortalPreferences).validate({
        preferences: { pinnedIds: [], orderedIds: [], layout: "grid" },
      }),
    ).toThrow();
  });
  it.each([
    listPersonalLinks,
    createPersonalLink,
    updatePersonalLink,
    deletePersonalLink,
    getPortalPreferences,
    savePortalPreferences,
    importPortalPreferences,
  ])("requires authenticated active organization membership", (fn) =>
    expect(asFn(fn).gates).toEqual([mocks.errors, mocks.member]),
  );
  it("takes identity only from middleware, not request body", async () => {
    await asFn(createPersonalLink).run({
      context,
      data: {
        name: "Docs",
        url: "https://example.org/",
        userId: "bob",
        organizationId: "org-b",
      },
    });
    expect(mocks.service.createLink).toHaveBeenCalledWith(
      context.org,
      expect.objectContaining({ name: "Docs" }),
    );
  });
  it("rejects unsafe URLs and excessive preference ids at the boundary", () => {
    expect(() =>
      asFn(createPersonalLink).validate({
        name: "Bad",
        url: "javascript:alert(1)",
      }),
    ).toThrow();
    expect(() =>
      asFn(createPersonalLink).validate({
        name: "Bad",
        url: "https://user:pass@example.org/",
      }),
    ).toThrow();
    expect(() =>
      asFn(savePortalPreferences).validate({
        pinnedIds: Array(201).fill("a"),
        orderedIds: [],
        layout: "grid",
      }),
    ).toThrow();
  });
});
