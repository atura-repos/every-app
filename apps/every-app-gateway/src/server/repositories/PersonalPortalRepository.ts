import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { personalLinks, portalPreferences } from "@/db/schema";

export type PortalPreferences = {
  pinnedIds: string[];
  orderedIds: string[];
  layout: "grid" | "list";
  revision?: number;
  collections?: { id: string; name: string }[];
  assignments?: Record<string, string>;
};

class PortalPreferencesConflict extends Error {
  readonly code = "PORTAL_PREFERENCES_CONFLICT";
  constructor() {
    super("Portal layout changed elsewhere");
  }
}

const owner = (organizationId: string, userId: string) =>
  and(
    eq(personalLinks.organizationId, organizationId),
    eq(personalLinks.userId, userId),
  );
const preferencesOwner = (organizationId: string, userId: string) =>
  and(
    eq(portalPreferences.organizationId, organizationId),
    eq(portalPreferences.userId, userId),
  );

export const PersonalPortalRepository = {
  listLinks: (organizationId: string, userId: string) =>
    db
      .select()
      .from(personalLinks)
      .where(owner(organizationId, userId))
      .orderBy(asc(personalLinks.name), asc(personalLinks.id)),
  createLink: (
    organizationId: string,
    userId: string,
    data: { id: string; name: string; url: string },
  ) => {
    const now = new Date();
    return db
      .insert(personalLinks)
      .values({
        ...data,
        organizationId,
        userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  },
  updateLink: (
    organizationId: string,
    userId: string,
    id: string,
    data: { name: string; url: string },
  ) =>
    db
      .update(personalLinks)
      .set({ ...data, updatedAt: new Date() })
      .where(and(owner(organizationId, userId), eq(personalLinks.id, id)))
      .returning()
      .get(),
  deleteLink: (organizationId: string, userId: string, id: string) =>
    db
      .delete(personalLinks)
      .where(and(owner(organizationId, userId), eq(personalLinks.id, id)))
      .returning()
      .get(),
  getPreferences: async (
    organizationId: string,
    userId: string,
  ): Promise<PortalPreferences | undefined> => {
    const row = await db
      .select()
      .from(portalPreferences)
      .where(preferencesOwner(organizationId, userId))
      .get();
    return row
      ? {
          pinnedIds: row.pinnedIds,
          orderedIds: row.orderedIds,
          layout: row.layout,
          revision: row.revision,
          collections: row.collections,
          assignments: row.assignments,
        }
      : undefined;
  },
  savePreferences: async (
    organizationId: string,
    userId: string,
    data: PortalPreferences,
    expectedRevision: number,
  ) => {
    const values = {
      pinnedIds: data.pinnedIds,
      orderedIds: data.orderedIds,
      layout: data.layout,
      ...(data.collections !== undefined
        ? { collections: data.collections }
        : {}),
      ...(data.assignments !== undefined
        ? { assignments: data.assignments }
        : {}),
    };
    let row;
    if (expectedRevision === 0) {
      row = await db
        .insert(portalPreferences)
        .values({ organizationId, userId, ...values, revision: 1 })
        .onConflictDoNothing()
        .returning()
        .get();
    }
    row ??= await db
      .update(portalPreferences)
      .set({ ...values, revision: sql`${portalPreferences.revision} + 1` })
      .where(
        and(
          preferencesOwner(organizationId, userId),
          eq(portalPreferences.revision, expectedRevision),
        ),
      )
      .returning()
      .get();
    if (!row) throw new PortalPreferencesConflict();
    return {
      ...values,
      collections: row.collections,
      assignments: row.assignments,
      revision: row.revision,
    };
  },
  // Import only if no server preference exists: a stale browser cannot roll back another device.
  importPreferences: (
    organizationId: string,
    userId: string,
    data: PortalPreferences,
  ) =>
    db
      .insert(portalPreferences)
      .values({ organizationId, userId, ...data })
      .onConflictDoNothing()
      .run(),
};
