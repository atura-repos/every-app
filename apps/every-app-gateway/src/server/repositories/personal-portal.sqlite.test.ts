import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import type { TestDb } from "@/test/sqlite-db";
const holder = vi.hoisted(() => ({ current: null as TestDb | null }));
vi.mock("@/db", async () => ({
  db: (await import("@/test/sqlite-db")).testDbProxy(holder),
}));
import { createTestDb, seedOrganization, seedMember } from "@/test/sqlite-db";
import { PersonalPortalRepository as repo } from "./PersonalPortalRepository";

describe("personal portal in migrated SQLite", () => {
  let a: string, b: string, alice: string, bob: string;
  beforeEach(async () => {
    holder.current = await createTestDb();
    a = await seedOrganization(holder.current, "personal-a");
    b = await seedOrganization(holder.current, "personal-b");
    alice = await seedMember(holder.current, { organizationId: a });
    bob = await seedMember(holder.current, { organizationId: a });
  });
  it("isolates links by member AND organization for reads and writes", async () => {
    await repo.createLink(a, alice, {
      id: "one",
      name: "Docs",
      url: "https://example.org/",
    });
    expect((await repo.listLinks(a, alice)).map((x) => x.id)).toEqual(["one"]);
    expect(await repo.listLinks(a, bob)).toEqual([]);
    expect(await repo.listLinks(b, alice)).toEqual([]);
    expect(
      await repo.updateLink(a, bob, "one", {
        name: "Stolen",
        url: "https://example.org/",
      }),
    ).toBeUndefined();
    expect(await repo.deleteLink(b, alice, "one")).toBeUndefined();
    expect((await repo.listLinks(a, alice))[0]?.name).toBe("Docs");
    expect(await repo.deleteLink(a, alice, "one")).toBeDefined();
  });
  it("deletes personal rows when the account is deleted", async () => {
    await repo.createLink(a, alice, {
      id: "owned",
      name: "Docs",
      url: "https://example.org/",
    });
    await repo.savePreferences(a, alice, {
      pinnedIds: [],
      orderedIds: [],
      layout: "grid",
    });
    await holder.current!.delete(users).where(eq(users.id, alice));
    expect(await repo.listLinks(a, alice)).toEqual([]);
    expect(await repo.getPreferences(a, alice)).toBeUndefined();
  });
  it("keeps preferences per account, persists order and does not overwrite on migration", async () => {
    const prefs = {
      pinnedIds: ["app2"],
      orderedIds: ["app2", "app1"],
      layout: "list" as const,
    };
    expect(await repo.getPreferences(a, alice)).toBeUndefined();
    await repo.savePreferences(a, alice, prefs);
    await repo.importPreferences(a, alice, {
      pinnedIds: [],
      orderedIds: [],
      layout: "grid",
    });
    expect(await repo.getPreferences(a, alice)).toEqual(prefs);
    expect(await repo.getPreferences(a, bob)).toBeUndefined();
    expect(await repo.getPreferences(b, alice)).toBeUndefined();
  });
});
