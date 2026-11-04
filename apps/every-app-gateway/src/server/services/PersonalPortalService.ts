import type { OrgContext } from "@/server/organization/orgContext";
import { PersonalPortalRepository as repo } from "@/server/repositories/PersonalPortalRepository";
import { PublicError } from "@/server/errors";
import { AppAccessRepository } from "@/server/repositories/AppAccessRepository";
import { ExternalLinkRepository } from "@/server/repositories/ExternalLinkRepository";
import { AppRepository } from "@/server/repositories/AppRepository";
import { platformPolicy } from "@/server/platform-policy";
import { env } from "cloudflare:workers";
import type { z } from "zod";
import type {
  personalLinkFormSchema,
  personalLinkUpdateSchema,
  portalPreferencesSchema,
} from "@/schemas/personalPortal";

type Link = z.output<typeof personalLinkFormSchema>;
type Update = z.output<typeof personalLinkUpdateSchema>;
type Preferences = z.output<typeof portalPreferencesSchema>;
type SavePreferences = Preferences & { expectedRevision: number };

async function validateKeys(
  ctx: OrgContext,
  data: Preferences,
  previous?: Preferences,
  allowLegacyImport = false,
) {
  const ids = new Set([
    ...data.pinnedIds,
    ...data.orderedIds,
    ...Object.keys(data.assignments ?? {}),
  ]);
  if (!ids.size) return;
  const [managed, shared, external, personal] = await Promise.all([
    AppAccessRepository.findAllByUserId(ctx.userId, ctx.orgId),
    platformPolicy(env).sharedApps ? AppRepository.findAllShared() : [],
    ExternalLinkRepository.list(
      ctx.orgId,
      ctx.userId,
      ctx.role === "owner" || ctx.role === "admin",
    ),
    repo.listLinks(ctx.orgId, ctx.userId),
  ]);
  const allowed = new Set([
    ...managed.map(({ app }) => `managed:${app.id}`),
    ...shared.map(({ id }) => `managed:${id}`),
    ...external.map(({ id }) => `external:${id}`),
    ...personal.map(({ id }) => `personal:${id}`),
  ]);
  const legacy = new Set(
    [...(previous?.pinnedIds ?? []), ...(previous?.orderedIds ?? [])].filter(
      (id) => !id.includes(":"),
    ),
  );
  for (const id of ids) {
    if (allowed.has(id)) continue;
    // A pre-existing raw managed preference remains inert when access is gone.
    if (
      !id.includes(":") &&
      (allowLegacyImport ||
        legacy.has(id) ||
        managed.some(({ app }) => app.id === id) ||
        shared.some((app) => app.id === id))
    )
      continue;
    throw new PublicError("INVALID_INPUT", "Preference item is unavailable");
  }
}
export const PersonalPortalService = {
  listLinks: (ctx: OrgContext) => repo.listLinks(ctx.orgId, ctx.userId),
  createLink: (ctx: OrgContext, data: Link) =>
    repo.createLink(ctx.orgId, ctx.userId, {
      id: crypto.randomUUID(),
      ...data,
    }),
  updateLink: async (ctx: OrgContext, data: Update) => {
    const row = await repo.updateLink(ctx.orgId, ctx.userId, data.id, {
      name: data.name,
      url: data.url,
    });
    if (!row) throw new PublicError("APP_NOT_FOUND", "Personal link not found");
    return row;
  },
  deleteLink: async (ctx: OrgContext, id: string) => {
    const row = await repo.deleteLink(ctx.orgId, ctx.userId, id);
    if (!row) throw new PublicError("APP_NOT_FOUND", "Personal link not found");
    return row;
  },
  getPreferences: (ctx: OrgContext) =>
    repo.getPreferences(ctx.orgId, ctx.userId),
  savePreferences: async (ctx: OrgContext, data: SavePreferences) => {
    const current = await repo.getPreferences(ctx.orgId, ctx.userId);
    await validateKeys(ctx, data, current);
    if (
      data.collections &&
      data.assignments === undefined &&
      current?.assignments &&
      Object.values(current.assignments).some(
        (id) => !data.collections!.some((c) => c.id === id),
      )
    )
      throw new PublicError(
        "INVALID_INPUT",
        "Collection assignments must be updated together",
      );
    return repo.savePreferences(
      ctx.orgId,
      ctx.userId,
      data,
      data.expectedRevision,
    );
  },
  importPreferences: async (ctx: OrgContext, data: Preferences) => {
    // Raw legacy IDs are inert unless currently authorized; typed keys require live access.
    await validateKeys(ctx, data, undefined, true);
    await repo.importPreferences(ctx.orgId, ctx.userId, data);
    return repo.getPreferences(ctx.orgId, ctx.userId);
  },
};
