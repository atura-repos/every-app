import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "@/test/sqlite-db";
const holder = vi.hoisted(() => ({ current: null as TestDb | null }));
vi.mock("@/db", async () => {
  const { testDbProxy } = await import("@/test/sqlite-db");
  return { db: testDbProxy(holder) };
});
import { eq } from "drizzle-orm";
import {
  externalLinks,
  externalLinkGroups,
  externalLinkUsers,
  groupMembers,
  groups,
  members,
  users,
} from "@/db/schema";
import { createTestDb, seedMember, seedOrganization } from "@/test/sqlite-db";
import { ExternalLinkService } from "./services/ExternalLinkService";
import { OrganizationMembersRepository } from "./repositories/OrganizationMembersRepository";

let db: TestDb;
let org: string;
let owner: string;
let user: string;
let second: string;
const ctx = (
  userId: string,
  orgId = org,
  role: "owner" | "member" = "member",
) => ({ orgId, userId, role });
const link = (access?: {
  everyone: boolean;
  userIds: string[];
  groupIds: string[];
}) =>
  ExternalLinkService.create(ctx(owner, org, "owner"), {
    name: "Risk",
    url: "https://example.org/",
    ...(access ? { access } : {}),
  });

beforeEach(async () => {
  db = holder.current = await createTestDb();
  org = await seedOrganization(db);
  owner = await seedMember(db, { organizationId: org, role: "owner" });
  user = await seedMember(db, { organizationId: org });
  second = await seedMember(db, { organizationId: org });
});

describe("external-link visibility on migrated SQLite", () => {
  it("defaults pre-existing-style rows to everyone after migration", async () => {
    await db.insert(externalLinks).values({
      id: crypto.randomUUID(),
      organizationId: org,
      name: "Legacy",
      url: "https://example.org/",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(
      (await ExternalLinkService.list(ctx(user))).map((row) => row.name),
    ).toEqual(["Legacy"]);
  });
  it("preserves legacy everyone-visible links and admins see restricted links", async () => {
    const legacy = await link();
    const restricted = await link({
      everyone: false,
      userIds: [],
      groupIds: [],
    });
    expect(
      (await ExternalLinkService.list(ctx(user))).map((row) => row.id),
    ).toEqual([legacy.id]);
    expect(
      (await ExternalLinkService.list(ctx(owner, org, "owner")))
        .map((row) => row.id)
        .sort(),
    ).toEqual([legacy.id, restricted.id].sort());
  });
  it("grants one user, not another or another organization; revocation hides immediately", async () => {
    const otherOrg = await seedOrganization(db);
    const outsider = await seedMember(db, { organizationId: otherOrg });
    const restricted = await link({
      everyone: false,
      userIds: [user],
      groupIds: [],
    });
    expect(
      (await ExternalLinkService.list(ctx(user))).map((row) => row.id),
    ).toContain(restricted.id);
    expect(await ExternalLinkService.list(ctx(second))).toEqual([]);
    expect(await ExternalLinkService.list(ctx(outsider, otherOrg))).toEqual([]);
    await expect(
      link({ everyone: false, userIds: [outsider], groupIds: [] }),
    ).rejects.toThrow();
    await ExternalLinkService.update(ctx(owner, org, "owner"), {
      id: restricted.id,
      name: "Risk",
      url: "https://example.org/",
      access: { everyone: false, userIds: [], groupIds: [] },
    });
    expect(await ExternalLinkService.list(ctx(user))).toEqual([]);
  });
  it("group grants stop on group removal, and direct grants remain independent", async () => {
    const groupId = "grp_abcdef0123456789";
    await db.insert(groups).values({
      id: groupId,
      organizationId: org,
      name: "Risk",
      createdBy: owner,
    });
    await db
      .insert(groupMembers)
      .values({ groupId, organizationId: org, userId: user });
    const restricted = await link({
      everyone: false,
      userIds: [second],
      groupIds: [groupId],
    });
    expect(
      (await ExternalLinkService.list(ctx(user))).map((row) => row.id),
    ).toContain(restricted.id);
    expect(
      (await ExternalLinkService.list(ctx(second))).map((row) => row.id),
    ).toContain(restricted.id);
    await db.delete(groupMembers).where(eq(groupMembers.userId, user));
    expect(await ExternalLinkService.list(ctx(user))).toEqual([]);
    expect(
      (await ExternalLinkService.list(ctx(second))).map((row) => row.id),
    ).toContain(restricted.id);
  });
  it("rejects foreign groups and makes banned, deactivated and removed members invisible", async () => {
    const foreignOrg = await seedOrganization(db);
    const foreignGroup = "grp_1234567890abcdef";
    await db.insert(groups).values({
      id: foreignGroup,
      organizationId: foreignOrg,
      name: "Foreign",
    });
    await expect(
      link({ everyone: false, userIds: [], groupIds: [foreignGroup] }),
    ).rejects.toThrow();
    await link({ everyone: false, userIds: [user], groupIds: [] });
    await db.update(users).set({ banned: true }).where(eq(users.id, user));
    expect(await ExternalLinkService.list(ctx(user))).toEqual([]);
    await db
      .update(users)
      .set({ banned: false, status: "deactivated" })
      .where(eq(users.id, user));
    expect(await ExternalLinkService.list(ctx(user))).toEqual([]);
    await db.update(users).set({ status: "active" }).where(eq(users.id, user));
    await db.delete(members).where(eq(members.userId, user));
    expect(await ExternalLinkService.list(ctx(user))).toEqual([]);
  });
  it("removing a member removes direct grants so rejoining does not restore them", async () => {
    const restricted = await link({
      everyone: false,
      userIds: [user],
      groupIds: [],
    });
    expect(await OrganizationMembersRepository.removeMember(user, org)).toBe(
      true,
    );
    expect(await db.select().from(externalLinkUsers)).toEqual([]);
    await db.insert(members).values({
      id: crypto.randomUUID(),
      organizationId: org,
      userId: user,
      role: "member",
      createdAt: new Date(),
    });
    expect(await ExternalLinkService.list(ctx(user))).toEqual([]);
    expect(
      (await ExternalLinkService.list(ctx(owner, org, "owner"))).map(
        (row) => row.id,
      ),
    ).toContain(restricted.id);
  });
  it("deleting a link cascades its grants", async () => {
    const restricted = await link({
      everyone: false,
      userIds: [user],
      groupIds: [],
    });
    await ExternalLinkService.delete(ctx(owner, org, "owner"), restricted.id);
    expect(await db.select().from(externalLinks)).toEqual([]);
    expect(await db.select().from(externalLinkUsers)).toEqual([]);
    expect(await db.select().from(externalLinkGroups)).toEqual([]);
    expect(await ExternalLinkService.list(ctx(user))).toEqual([]);
  });
});
