import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "@/test/sqlite-db";
const holder = vi.hoisted(() => ({ current: null as TestDb | null }));
vi.mock("@/db", async () => ({
  db: (await import("@/test/sqlite-db")).testDbProxy(holder),
}));
import { createTestDb, seedOrganization } from "@/test/sqlite-db";
import { ExternalLinkRepository } from "./ExternalLinkRepository";

describe("external link persistence (migrated SQLite)", () => {
  let a: string, b: string;
  beforeEach(async () => {
    holder.current = await createTestDb();
    a = await seedOrganization(holder.current, "links-a");
    b = await seedOrganization(holder.current, "links-b");
  });
  it("creates and lists links only in their organization", async () => {
    await ExternalLinkRepository.create({
      id: "link-a",
      organizationId: a,
      name: "Risk",
      url: "https://example.org/",
    });
    expect(
      (await ExternalLinkRepository.list(a)).map((row) => row.name),
    ).toEqual(["Risk"]);
    expect(await ExternalLinkRepository.list(b)).toEqual([]);
  });
  it("cannot update or delete another organization's link by id", async () => {
    await ExternalLinkRepository.create({
      id: "link-a",
      organizationId: a,
      name: "Risk",
      url: "https://example.org/",
    });
    expect(
      await ExternalLinkRepository.update(b, "link-a", {
        name: "Changed",
        url: "https://evil.example/",
      }),
    ).toBeUndefined();
    expect(await ExternalLinkRepository.delete(b, "link-a")).toBeUndefined();
    expect((await ExternalLinkRepository.list(a))[0]?.name).toBe("Risk");
    expect(await ExternalLinkRepository.delete(a, "link-a")).toBeDefined();
    expect(await ExternalLinkRepository.list(a)).toEqual([]);
  });
});
