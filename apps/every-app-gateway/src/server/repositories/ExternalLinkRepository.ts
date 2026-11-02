import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { externalLinks } from "@/db/schema";

/** Every lookup and mutation includes organization_id, including ID-based writes. */
export const ExternalLinkRepository = {
  list: (organizationId: string) =>
    db
      .select()
      .from(externalLinks)
      .where(eq(externalLinks.organizationId, organizationId))
      .orderBy(asc(externalLinks.name), asc(externalLinks.id)),
  create: (data: {
    id: string;
    organizationId: string;
    name: string;
    url: string;
  }) => {
    const now = new Date();
    return db
      .insert(externalLinks)
      .values({ ...data, createdAt: now, updatedAt: now })
      .returning()
      .get();
  },
  update: (
    organizationId: string,
    id: string,
    data: { name: string; url: string },
  ) =>
    db
      .update(externalLinks)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(externalLinks.id, id),
          eq(externalLinks.organizationId, organizationId),
        ),
      )
      .returning()
      .get(),
  delete: (organizationId: string, id: string) =>
    db
      .delete(externalLinks)
      .where(
        and(
          eq(externalLinks.id, id),
          eq(externalLinks.organizationId, organizationId),
        ),
      )
      .returning()
      .get(),
};
