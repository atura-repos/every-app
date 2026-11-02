import type { OrgContext } from "@/server/organization/orgContext";
import { ExternalLinkRepository } from "@/server/repositories/ExternalLinkRepository";
import { PublicError } from "@/server/errors";
import type { z } from "zod";
import type {
  externalLinkFormSchema,
  externalLinkUpdateSchema,
} from "@/schemas/externalLink";
type Input = z.output<typeof externalLinkFormSchema>;
type Update = z.output<typeof externalLinkUpdateSchema>;

export const ExternalLinkService = {
  list: (ctx: OrgContext) => ExternalLinkRepository.list(ctx.orgId),
  create: (ctx: OrgContext, data: Input) =>
    ExternalLinkRepository.create({
      id: crypto.randomUUID(),
      organizationId: ctx.orgId,
      ...data,
    }),
  update: async (ctx: OrgContext, data: Update) => {
    const row = await ExternalLinkRepository.update(ctx.orgId, data.id, {
      name: data.name,
      url: data.url,
    });
    if (!row) throw new PublicError("APP_NOT_FOUND", "External link not found");
    return row;
  },
  delete: async (ctx: OrgContext, id: string) => {
    const row = await ExternalLinkRepository.delete(ctx.orgId, id);
    if (!row) throw new PublicError("APP_NOT_FOUND", "External link not found");
    return row;
  },
};
