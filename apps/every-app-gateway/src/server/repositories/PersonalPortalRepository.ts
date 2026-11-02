import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { personalLinks, portalPreferences } from "@/db/schema";

export type PortalPreferences = {
  pinnedIds: string[];
  orderedIds: string[];
  layout: "grid" | "list";
};

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
        }
      : undefined;
  },
  savePreferences: (
    organizationId: string,
    userId: string,
    data: PortalPreferences,
  ) =>
    db
      .insert(portalPreferences)
      .values({ organizationId, userId, ...data })
      .onConflictDoUpdate({
        target: [portalPreferences.organizationId, portalPreferences.userId],
        set: data,
      })
      .run(),
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
