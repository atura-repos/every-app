import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: {}, member: {}, errors: {} }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b: Record<string, unknown> = {};
    b.middleware = (m: unknown[]) => {
      b.gates = m;
      return b;
    };
    b.validator = (v: unknown) => {
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
  organizationAdminMiddleware: mocks.admin,
  organizationMemberMiddleware: mocks.member,
}));
vi.mock("@/middleware/publicError", () => ({
  publicErrorMiddleware: mocks.errors,
}));
vi.mock("@/server/services/ExternalLinkService", () => ({
  ExternalLinkService: {},
}));
import {
  listExternalLinks,
  createExternalLink,
  updateExternalLink,
  getExternalLinkAccess,
  externalLinkAccessOptions,
  deleteExternalLink,
} from "./externalLinks";
describe("external link server functions", () => {
  it("allows only members to list", () =>
    expect((listExternalLinks as never as { gates: unknown[] }).gates).toEqual([
      mocks.errors,
      mocks.member,
    ]));
  it.each([
    createExternalLink,
    updateExternalLink,
    deleteExternalLink,
    externalLinkAccessOptions,
    getExternalLinkAccess,
  ])("allows only admins to mutate", (fn) =>
    expect((fn as never as { gates: unknown[] }).gates).toEqual([
      mocks.errors,
      mocks.admin,
    ]),
  );
});
