import { and, asc, eq, exists, or, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import { liveUser } from "./OrganizationMembersRepository";
import {
  externalLinks,
  externalLinkUsers,
  externalLinkGroups,
  groupMembers,
  groups,
  members,
  users,
} from "@/db/schema";

type Access = { everyone: boolean; userIds: string[]; groupIds: string[] };
const scoped = (organizationId: string, id: string) =>
  and(
    eq(externalLinks.id, id),
    eq(externalLinks.organizationId, organizationId),
  );

/** A single SQL predicate: no client-side filtering, no duplicated rows for overlapping grants. */
const visibleTo = (organizationId: string, userId: string) =>
  or(
    eq(externalLinks.everyone, true),
    exists(
      db
        .select({ one: sql`1` })
        .from(externalLinkUsers)
        .where(
          and(
            eq(externalLinkUsers.linkId, externalLinks.id),
            eq(externalLinkUsers.organizationId, organizationId),
            eq(externalLinkUsers.userId, userId),
          ),
        ),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(externalLinkGroups)
        .innerJoin(
          groupMembers,
          and(
            eq(groupMembers.groupId, externalLinkGroups.groupId),
            eq(groupMembers.organizationId, organizationId),
          ),
        )
        .where(
          and(
            eq(externalLinkGroups.linkId, externalLinks.id),
            eq(externalLinkGroups.organizationId, organizationId),
            eq(groupMembers.userId, userId),
          ),
        ),
    ),
  );

async function list(organizationId: string, userId: string, admin: boolean) {
  // Also fail closed if called without the session middleware, or after offboarding.
  const active = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(
      members,
      and(
        eq(members.userId, users.id),
        eq(members.organizationId, organizationId),
      ),
    )
    .where(and(eq(users.id, userId), liveUser(), eq(users.status, "active")))
    .limit(1);
  if (!active.length) return [];
  return db
    .select()
    .from(externalLinks)
    .where(
      and(
        eq(externalLinks.organizationId, organizationId),
        ...(admin ? [] : [visibleTo(organizationId, userId)]),
      ),
    )
    .orderBy(asc(externalLinks.name), asc(externalLinks.id));
}

async function options(organizationId: string) {
  const [people, teams] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(
        and(
          eq(members.organizationId, organizationId),
          liveUser(),
          eq(users.status, "active"),
        ),
      )
      .orderBy(asc(users.name)),
    db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(eq(groups.organizationId, organizationId))
      .orderBy(asc(groups.name)),
  ]);
  return { people, groups: teams };
}

async function access(organizationId: string, id: string) {
  const [link] = await db
    .select({ everyone: externalLinks.everyone })
    .from(externalLinks)
    .where(scoped(organizationId, id));
  if (!link) return null;
  const [people, teams] = await Promise.all([
    db
      .select({ userId: externalLinkUsers.userId })
      .from(externalLinkUsers)
      .where(
        and(
          eq(externalLinkUsers.linkId, id),
          eq(externalLinkUsers.organizationId, organizationId),
        ),
      ),
    db
      .select({ groupId: externalLinkGroups.groupId })
      .from(externalLinkGroups)
      .where(
        and(
          eq(externalLinkGroups.linkId, id),
          eq(externalLinkGroups.organizationId, organizationId),
        ),
      ),
  ]);
  return {
    everyone: link.everyone,
    userIds: people.map((p) => p.userId),
    groupIds: teams.map((g) => g.groupId),
  };
}

async function validateAccess(organizationId: string, access: Access) {
  const userIds = [...new Set(access.userIds)];
  const groupIds = [...new Set(access.groupIds)];
  // Bounded chunks keep D1's 100-bind limit; reject the entire change before writes.
  for (let i = 0; i < userIds.length; i += 80) {
    const ids = userIds.slice(i, i + 80);
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(
        members,
        and(
          eq(members.userId, users.id),
          eq(members.organizationId, organizationId),
        ),
      )
      .where(
        and(inArray(users.id, ids), liveUser(), eq(users.status, "active")),
      );
    if (rows.length !== ids.length)
      throw new Error("Member not found in this workspace or inactive");
  }
  for (let i = 0; i < groupIds.length; i += 80) {
    const ids = groupIds.slice(i, i + 80);
    const rows = await db
      .select({ id: groups.id })
      .from(groups)
      .where(
        and(eq(groups.organizationId, organizationId), inArray(groups.id, ids)),
      );
    if (rows.length !== ids.length)
      throw new Error("Group not found in this workspace");
  }
  return { everyone: access.everyone, userIds, groupIds };
}

function grantStatements(organizationId: string, id: string, access: Access) {
  const statements = [];
  for (let i = 0; i < access.userIds.length; i += 30)
    statements.push(
      db
        .insert(externalLinkUsers)
        .values(
          access.userIds
            .slice(i, i + 30)
            .map((userId) => ({ linkId: id, organizationId, userId })),
        ),
    );
  for (let i = 0; i < access.groupIds.length; i += 30)
    statements.push(
      db
        .insert(externalLinkGroups)
        .values(
          access.groupIds
            .slice(i, i + 30)
            .map((groupId) => ({ linkId: id, organizationId, groupId })),
        ),
    );
  return statements;
}

async function create(data: {
  id: string;
  organizationId: string;
  name: string;
  url: string;
  access?: Access;
}) {
  const access = await validateAccess(
    data.organizationId,
    data.access ?? { everyone: true, userIds: [], groupIds: [] },
  );
  const now = new Date();
  const row = {
    id: data.id,
    organizationId: data.organizationId,
    name: data.name,
    url: data.url,
    everyone: access.everyone,
    createdAt: now,
    updatedAt: now,
  };
  await db.batch([
    db.insert(externalLinks).values(row),
    ...grantStatements(data.organizationId, data.id, access),
  ]);
  return row;
}

async function update(
  organizationId: string,
  id: string,
  data: { name: string; url: string; access?: Access },
) {
  const current = await access(organizationId, id);
  if (!current) return undefined;
  const next = await validateAccess(organizationId, data.access ?? current);
  await db.batch([
    db
      .update(externalLinks)
      .set({
        name: data.name,
        url: data.url,
        everyone: next.everyone,
        updatedAt: new Date(),
      })
      .where(scoped(organizationId, id)),
    db
      .delete(externalLinkUsers)
      .where(
        and(
          eq(externalLinkUsers.linkId, id),
          eq(externalLinkUsers.organizationId, organizationId),
        ),
      ),
    db
      .delete(externalLinkGroups)
      .where(
        and(
          eq(externalLinkGroups.linkId, id),
          eq(externalLinkGroups.organizationId, organizationId),
        ),
      ),
    ...grantStatements(organizationId, id, next),
  ]);
  return db
    .select()
    .from(externalLinks)
    .where(scoped(organizationId, id))
    .get();
}

const remove = (organizationId: string, id: string) =>
  db.delete(externalLinks).where(scoped(organizationId, id)).returning().get();
export const ExternalLinkRepository = {
  list,
  options,
  access,
  create,
  update,
  delete: remove,
};
