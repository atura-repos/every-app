import type { OrgContext } from "@/server/organization/orgContext";
import { PersonalPortalRepository as repo } from "@/server/repositories/PersonalPortalRepository";
import { PublicError } from "@/server/errors";
import type { z } from "zod";
import type {
  personalLinkFormSchema,
  personalLinkUpdateSchema,
  portalPreferencesSchema,
} from "@/schemas/personalPortal";

type Link = z.output<typeof personalLinkFormSchema>;
type Update = z.output<typeof personalLinkUpdateSchema>;
type Preferences = z.output<typeof portalPreferencesSchema>;
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
  savePreferences: async (ctx: OrgContext, data: Preferences) => {
    await repo.savePreferences(ctx.orgId, ctx.userId, data);
  },
  importPreferences: async (ctx: OrgContext, data: Preferences) => {
    await repo.importPreferences(ctx.orgId, ctx.userId, data);
    return repo.getPreferences(ctx.orgId, ctx.userId);
  },
};
