import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "@/test/sqlite-db";
const holder = vi.hoisted(() => ({ current: null as TestDb | null }));
vi.mock("@/db", async () => ({
  db: (await import("@/test/sqlite-db")).testDbProxy(holder),
}));
import { createTestDb, seedOrganization, seedMember } from "@/test/sqlite-db";
import { ExternalLinkRepository } from "./ExternalLinkRepository";

describe("external link persistence (migrated SQLite)", () => {
  let a: string, b: string, userA: string, userB: string;
  beforeEach(async () => {
    holder.current = await createTestDb();
    a = await seedOrganization(holder.current, "links-a");
    b = await seedOrganization(holder.current, "links-b");
    userA = await seedMember(holder.current, { organizationId: a });
    userB = await seedMember(holder.current, { organizationId: b });
  });
  it("creates and lists links only in their organization", async () => {
    await ExternalLinkRepository.create({
      id: "link-a",
      organizationId: a,
      name: "Risk",
      url: "https://example.org/",
      access: { everyone: true, userIds: [], groupIds: [] },
    });
    expect(
      (await ExternalLinkRepository.list(a, userA, false)).map(
        (row) => row.name,
      ),
    ).toEqual(["Risk"]);
    expect(await ExternalLinkRepository.list(b, userB, false)).toEqual([]);
  });
  it("cannot update or delete another organization's link by id", async () => {
    await ExternalLinkRepository.create({
      id: "link-a",
      organizationId: a,
      name: "Risk",
      url: "https://example.org/",
      access: { everyone: true, userIds: [], groupIds: [] },
    });
    expect(
      await ExternalLinkRepository.update(b, "link-a", {
        name: "Changed",
        url: "https://evil.example/",
        confirmedHostname: "evil.example",
      }),
    ).toBeUndefined();
    expect(await ExternalLinkRepository.delete(b, "link-a")).toBeUndefined();
    expect((await ExternalLinkRepository.list(a, userA, false))[0]?.name).toBe(
      "Risk",
    );
    expect(await ExternalLinkRepository.delete(a, "link-a")).toBeDefined();
    expect(await ExternalLinkRepository.list(a, userA, false)).toEqual([]);
  });
  it("keeps an unsafe legacy URL on name edit but refuses replacing it with an unsafe destination", async () => {
    const id = crypto.randomUUID();
    await holder
      .current!.insert((await import("@/db/schema")).externalLinks)
      .values({
        id,
        organizationId: a,
        name: "Old",
        url: "https://example.org:8443/",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    await ExternalLinkRepository.update(a, id, {
      name: "Renamed",
      url: "https://example.org:8443/",
      confirmedHostname: "example.org",
    });
    expect((await ExternalLinkRepository.list(a, userA, true))[0]?.name).toBe(
      "Renamed",
    );
    await expect(
      ExternalLinkRepository.update(a, id, {
        name: "Wrong",
        url: "https://example.org/?token=private-value",
        confirmedHostname: "example.org",
      }),
    ).rejects.toThrow();
    expect((await ExternalLinkRepository.list(a, userA, true))[0]?.url).toBe(
      "https://example.org:8443/",
    );
    expect(await ExternalLinkRepository.delete(a, id)).toBeDefined();
  });
  it("requires explicit access and valid URL even for direct repository creates", async () => {
    await expect(
      ExternalLinkRepository.create({
        id: "bad",
        organizationId: a,
        name: "Bad",
        url: "https://example.org/?password=private-value",
        access: { everyone: true, userIds: [], groupIds: [] },
      }),
    ).rejects.toThrow();
    await expect(
      ExternalLinkRepository.create({
        id: "bad",
        organizationId: a,
        name: "Bad",
        url: "https://example.org/",
      } as Parameters<typeof ExternalLinkRepository.create>[0]),
    ).rejects.toThrow();
    expect(await ExternalLinkRepository.list(a, userA, true)).toEqual([]);
  });
});
