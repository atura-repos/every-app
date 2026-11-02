import { describe, expect, it, vi, beforeEach } from "vitest";
const repo = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("@/server/repositories/ExternalLinkRepository", () => ({
  ExternalLinkRepository: repo,
}));
import { ExternalLinkService } from "./ExternalLinkService";
const org = { orgId: "org-a", userId: "user-a", role: "admin" } as const;
const other = { ...org, orgId: "org-b" };
beforeEach(() => vi.clearAllMocks());
describe("external links stay inside the active organization", () => {
  it("lists only the current organization", async () => {
    repo.list.mockResolvedValue([]);
    await ExternalLinkService.list(org);
    expect(repo.list).toHaveBeenCalledWith("org-a");
  });
  it("creates only in the current organization, never an app", async () => {
    await ExternalLinkService.create(org, {
      name: "Risk",
      url: "https://example.org/",
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-a",
        name: "Risk",
        url: "https://example.org/",
      }),
    );
  });
  it("cannot update a link in another organization", async () => {
    repo.update.mockResolvedValue(undefined);
    await expect(
      ExternalLinkService.update(other, {
        id: crypto.randomUUID(),
        name: "X",
        url: "https://example.org/",
      }),
    ).rejects.toThrow("External link not found");
    expect(repo.update).toHaveBeenCalledWith(
      "org-b",
      expect.any(String),
      expect.any(Object),
    );
  });
  it("cannot delete a link in another organization", async () => {
    repo.delete.mockResolvedValue(undefined);
    await expect(
      ExternalLinkService.delete(other, crypto.randomUUID()),
    ).rejects.toThrow("External link not found");
    expect(repo.delete).toHaveBeenCalledWith("org-b", expect.any(String));
  });
});
