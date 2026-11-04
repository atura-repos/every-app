import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { users, apps, userAppAccess } from "@/db/schema";
import type { TestDb } from "@/test/sqlite-db";
const holder = vi.hoisted(() => ({ current: null as TestDb | null }));
vi.mock("cloudflare:workers", () => ({
  env: { GATEWAY_DEPLOYMENT_MODE: "hosted" },
}));
vi.mock("@/db", async () => ({
  db: (await import("@/test/sqlite-db")).testDbProxy(holder),
}));
import { createTestDb, seedOrganization, seedMember } from "@/test/sqlite-db";
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { PersonalPortalRepository as repo } from "./PersonalPortalRepository";
import { PersonalPortalService } from "../services/PersonalPortalService";
import { ExternalLinkService } from "../services/ExternalLinkService";

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
    await repo.savePreferences(
      a,
      alice,
      {
        pinnedIds: [],
        orderedIds: [],
        layout: "grid",
      },
      0,
    );
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
    await repo.savePreferences(a, alice, prefs, 0);
    await repo.importPreferences(a, alice, {
      pinnedIds: [],
      orderedIds: [],
      layout: "grid",
    });
    expect(await repo.getPreferences(a, alice)).toEqual({
      ...prefs,
      collections: [],
      assignments: {},
      revision: 1,
    });
    expect(await repo.getPreferences(a, bob)).toBeUndefined();
    expect(await repo.getPreferences(b, alice)).toBeUndefined();
  });
  it("persists collections with CAS and keeps an older client from erasing them", async () => {
    const collection = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Daily",
    };
    await repo.savePreferences(
      a,
      alice,
      {
        pinnedIds: [],
        orderedIds: [],
        layout: "grid",
        collections: [collection],
        assignments: { "personal:item": collection.id },
      },
      0,
    );
    expect(await repo.getPreferences(a, alice)).toMatchObject({
      collections: [collection],
      assignments: { "personal:item": collection.id },
      revision: 1,
    });
    await repo.savePreferences(
      a,
      alice,
      { pinnedIds: [], orderedIds: [], layout: "list" },
      1,
    );
    expect(await repo.getPreferences(a, alice)).toMatchObject({
      collections: [collection],
      assignments: { "personal:item": collection.id },
      layout: "list",
      revision: 2,
    });
    await expect(
      repo.savePreferences(
        a,
        alice,
        {
          pinnedIds: [],
          orderedIds: [],
          layout: "grid",
          collections: [],
          assignments: {},
        },
        1,
      ),
    ).rejects.toMatchObject({ code: "PORTAL_PREFERENCES_CONFLICT" });
  });
  it("atomically refuses stale revisions and competing first writes", async () => {
    const first = {
      pinnedIds: ["old"],
      orderedIds: ["old"],
      layout: "list" as const,
    };
    expect(await repo.savePreferences(a, alice, first, 0)).toEqual({
      ...first,
      collections: [],
      assignments: {},
      revision: 1,
    });
    await expect(
      repo.savePreferences(a, alice, { ...first, layout: "grid" }, 0),
    ).rejects.toMatchObject({ code: "PORTAL_PREFERENCES_CONFLICT" });
    expect(await repo.getPreferences(a, alice)).toEqual({
      ...first,
      collections: [],
      assignments: {},
      revision: 1,
    });
    const second = { ...first, pinnedIds: ["new"] };
    expect(await repo.savePreferences(a, alice, second, 1)).toEqual({
      ...second,
      collections: [],
      assignments: {},
      revision: 2,
    });
    await expect(
      repo.savePreferences(a, alice, first, 1),
    ).rejects.toMatchObject({ code: "PORTAL_PREFERENCES_CONFLICT" });
    expect(await repo.getPreferences(a, alice)).toEqual({
      ...second,
      collections: [],
      assignments: {},
      revision: 2,
    });
    expect(await repo.savePreferences(a, bob, first, 0)).toMatchObject({
      revision: 1,
    });
  });
  it("allows only one winner when two browser saves race on the same revision", async () => {
    const first = {
      pinnedIds: ["first"],
      orderedIds: [],
      layout: "grid" as const,
    };
    const second = {
      pinnedIds: ["second"],
      orderedIds: [],
      layout: "list" as const,
    };
    const outcomes = await Promise.allSettled([
      repo.savePreferences(a, alice, first, 0),
      repo.savePreferences(a, alice, second, 0),
    ]);
    expect(outcomes.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const winner = outcomes.find((result) => result.status === "fulfilled");
    expect(await repo.getPreferences(a, alice)).toEqual(
      winner?.status === "fulfilled" ? winner.value : undefined,
    );
    expect(
      (
        await repo.savePreferences(
          b,
          await seedMember(holder.current!, { organizationId: b }),
          second,
          0,
        )
      ).revision,
    ).toBe(1);
  });
  it("rejects a revoked saved assignment until reset removes the inert key", async () => {
    const ctx = { orgId: a, userId: alice, role: "member" as const };
    const own = await PersonalPortalService.createLink(ctx, {
      name: "Old",
      url: "https://example.org/",
    });
    const collection = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Daily",
    };
    const key = `personal:${own.id}`;
    await PersonalPortalService.savePreferences(ctx, {
      pinnedIds: [key],
      orderedIds: [key],
      layout: "grid",
      expectedRevision: 0,
      collections: [collection],
      assignments: { [key]: collection.id },
    });
    await PersonalPortalService.deleteLink(ctx, own.id);
    await expect(
      PersonalPortalService.savePreferences(ctx, {
        pinnedIds: [key],
        orderedIds: [key],
        layout: "list",
        expectedRevision: 1,
        collections: [collection],
        assignments: { [key]: collection.id },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      PersonalPortalService.savePreferences(ctx, {
        pinnedIds: [],
        orderedIds: [],
        layout: "grid",
        expectedRevision: 1,
        collections: [],
        assignments: {},
      }),
    ).resolves.toMatchObject({ revision: 2 });
  });
  it("rejects a collection assignment to a foreign personal link", async () => {
    const foreign = await PersonalPortalService.createLink(
      { orgId: a, userId: bob, role: "member" },
      { name: "Foreign", url: "https://example.org/" },
    );
    await expect(
      PersonalPortalService.savePreferences(
        { orgId: a, userId: alice, role: "member" },
        {
          pinnedIds: [],
          orderedIds: [],
          layout: "grid",
          expectedRevision: 0,
          collections: [
            { id: "11111111-1111-4111-8111-111111111111", name: "Daily" },
          ],
          assignments: {
            [`personal:${foreign.id}`]: "11111111-1111-4111-8111-111111111111",
          },
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("rejects absent, foreign and revoked typed keys but preserves existing raw legacy ids", async () => {
    const ctx = { orgId: a, userId: alice, role: "member" as const };
    const prefs = (key: string) => ({
      pinnedIds: [key],
      orderedIds: [key],
      layout: "grid" as const,
      expectedRevision: 0,
    });
    for (const kind of ["managed", "external", "personal", "unknown"]) {
      await expect(
        PersonalPortalService.savePreferences(ctx, prefs(`${kind}:missing`)),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    const personal = await PersonalPortalService.createLink(ctx, {
      name: "Mine",
      url: "https://example.org/",
    });
    const foreign = await PersonalPortalService.createLink(
      { ...ctx, userId: bob },
      { name: "Theirs", url: "https://example.org/" },
    );
    await expect(
      PersonalPortalService.savePreferences(
        ctx,
        prefs(`personal:${foreign.id}`),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const external = await ExternalLinkService.create(
      { ...ctx, role: "owner" },
      {
        name: "Private",
        url: "https://example.org/",
        access: { everyone: false, userIds: [bob], groupIds: [] },
      },
    );
    await expect(
      PersonalPortalService.savePreferences(
        ctx,
        prefs(`external:${external.id}`),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await repo.importPreferences(a, alice, {
      pinnedIds: ["legacy-revoked"],
      orderedIds: ["legacy-revoked"],
      layout: "list",
    });
    expect(await repo.getPreferences(a, alice)).toMatchObject({
      revision: 0,
      pinnedIds: ["legacy-revoked"],
    });
    expect(
      await PersonalPortalService.savePreferences(ctx, {
        pinnedIds: ["legacy-revoked", `personal:${personal.id}`],
        orderedIds: ["legacy-revoked"],
        layout: "list",
        expectedRevision: 0,
      }),
    ).toMatchObject({ revision: 1 });
    await expect(
      PersonalPortalService.savePreferences(ctx, {
        ...prefs("forged-raw"),
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("rejects a managed key without a grant and accepts it only while the actual grant exists", async () => {
    const ctx = { orgId: a, userId: alice, role: "member" as const };
    const id = crypto.randomUUID();
    await holder.current!.insert(apps).values({
      id,
      organizationId: a,
      appSlug: "example",
      name: "Example",
      description: "Test",
    });
    const data = {
      pinnedIds: [`managed:${id}`],
      orderedIds: [`managed:${id}`],
      layout: "grid" as const,
      expectedRevision: 0,
    };
    await expect(
      PersonalPortalService.savePreferences(ctx, data),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await holder.current!.insert(userAppAccess).values({
      id: crypto.randomUUID(),
      organizationId: a,
      userId: alice,
      appRowId: id,
    });
    expect(
      await PersonalPortalService.savePreferences(ctx, data),
    ).toMatchObject({ revision: 1 });
    await holder
      .current!.delete(userAppAccess)
      .where(eq(userAppAccess.appRowId, id));
    await expect(
      PersonalPortalService.savePreferences(ctx, {
        ...data,
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("only accepts external keys while the member actually sees their workspace link", async () => {
    const ctx = { orgId: a, userId: alice, role: "member" as const };
    const owner = await seedMember(holder.current!, {
      organizationId: a,
      role: "owner",
    });
    const link = await ExternalLinkService.create(
      { orgId: a, userId: owner, role: "owner" },
      {
        name: "Team",
        url: "https://example.org/",
        access: { everyone: false, userIds: [alice], groupIds: [] },
      },
    );
    const data = {
      pinnedIds: [`external:${link.id}`],
      orderedIds: [],
      layout: "grid" as const,
      expectedRevision: 0,
    };
    expect(
      await PersonalPortalService.savePreferences(ctx, data),
    ).toMatchObject({ revision: 1 });
    await ExternalLinkService.update(
      { orgId: a, userId: owner, role: "owner" },
      {
        id: link.id,
        name: "Team",
        url: "https://example.org/",
        confirmedHostname: "example.org",
        access: { everyone: false, userIds: [], groupIds: [] },
      },
    );
    await expect(
      PersonalPortalService.savePreferences(ctx, {
        ...data,
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const foreign = await ExternalLinkService.create(
      {
        orgId: b,
        userId: await seedMember(holder.current!, {
          organizationId: b,
          role: "owner",
        }),
        role: "owner",
      },
      {
        name: "Foreign",
        url: "https://example.org/",
        access: { everyone: true, userIds: [], groupIds: [] },
      },
    );
    await expect(
      PersonalPortalService.savePreferences(ctx, {
        ...data,
        pinnedIds: [`external:${foreign.id}`],
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("preserves imported raw managed IDs even after access was revoked, without granting a typed tile", async () => {
    const ctx = { orgId: a, userId: alice, role: "member" as const };
    const data = {
      pinnedIds: ["revoked-legacy"],
      orderedIds: ["revoked-legacy"],
      layout: "list" as const,
    };
    expect(
      await PersonalPortalService.importPreferences(ctx, data),
    ).toMatchObject({ ...data, revision: 0 });
    await expect(
      PersonalPortalService.importPreferences(ctx, {
        ...data,
        pinnedIds: ["managed:missing"],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await repo.getPreferences(a, alice)).toMatchObject(data);
  });
  it("accepts a hosted shared managed app without a direct grant", async () => {
    const id = crypto.randomUUID();
    await holder.current!.insert(apps).values({
      id,
      organizationId: b,
      appSlug: "shared",
      name: "Shared",
      description: "Test",
      scope: "shared",
    });
    const saved = await PersonalPortalService.savePreferences(
      { orgId: a, userId: alice, role: "member" },
      {
        pinnedIds: [`managed:${id}`],
        orderedIds: [],
        layout: "grid",
        expectedRevision: 0,
      },
    );
    expect(saved.revision).toBe(1);
  });
  it("upgrades an existing SQL preference row without losing legacy arrays or layout", async () => {
    const old = createClient({ url: ":memory:" });
    try {
      await old.execute(
        "CREATE TABLE portal_preferences (organization_id text NOT NULL, user_id text NOT NULL, pinned_ids text NOT NULL, ordered_ids text NOT NULL, layout text NOT NULL, PRIMARY KEY (organization_id, user_id))",
      );
      await old.execute({
        sql: "INSERT INTO portal_preferences VALUES (?, ?, ?, ?, ?)",
        args: [
          "org",
          "user",
          JSON.stringify(["old", "unavailable"]),
          JSON.stringify(["unavailable", "old"]),
          "list",
        ],
      });
      const migration = readFileSync(
        new URL(
          "../../../drizzle/0026_portal_preferences_revision.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await old.execute(migration);
      await old.execute(
        readFileSync(
          new URL(
            "../../../drizzle/0027_portal_collections.sql",
            import.meta.url,
          ),
          "utf8",
        )
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter(Boolean)[0],
      );
      await old.execute(
        readFileSync(
          new URL(
            "../../../drizzle/0027_portal_collections.sql",
            import.meta.url,
          ),
          "utf8",
        )
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter(Boolean)[1],
      );
      const result = await old.execute(
        "SELECT pinned_ids, ordered_ids, layout, revision, collections, assignments FROM portal_preferences",
      );
      expect(result.rows[0]).toMatchObject({
        pinned_ids: '["old","unavailable"]',
        ordered_ids: '["unavailable","old"]',
        layout: "list",
        revision: 0,
        collections: "[]",
        assignments: "{}",
      });
    } finally {
      old.close();
    }
  });
});
