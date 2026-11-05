import { z } from "zod";
import { externalLinkFormSchema } from "./externalLink";
export const personalLinkFormSchema = externalLinkFormSchema;
export const personalLinkUpdateSchema = personalLinkFormSchema.extend({
  id: z.string().uuid(),
});
export const personalLinkDeleteSchema = z.object({ id: z.string().uuid() });
const ids = z
  .array(z.string().min(1).max(200))
  .max(200)
  .refine((xs) => new Set(xs).size === xs.length, "Duplicate app ids");
const collection = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(64),
});
const typedKey = z.string().regex(/^(managed|external|personal):[^:]{1,200}$/);
export const portalPreferencesSchema = z
  .object({
    pinnedIds: ids,
    orderedIds: ids,
    layout: z.enum(["grid", "list"]),
    // Optional on the wire for older clients; the service preserves existing values on omission.
    collections: z.array(collection).max(20).optional(),
    assignments: z.record(typedKey, z.string().uuid()).optional(),
  })
  .superRefine((value, ctx) => {
    const collections = value.collections ?? [];
    if (new Set(collections.map((c) => c.id)).size !== collections.length)
      ctx.addIssue({ code: "custom", message: "Duplicate collection id" });
    if (Object.keys(value.assignments ?? {}).length > 200)
      ctx.addIssue({ code: "custom", message: "Too many assignments" });
    for (const id of Object.values(value.assignments ?? {}))
      if (!collections.some((c) => c.id === id))
        ctx.addIssue({ code: "custom", message: "Unknown collection" });
  });
export const portalPreferencesSaveSchema = portalPreferencesSchema.safeExtend({
  expectedRevision: z.number().int().nonnegative().safe(),
});
export const portalPreferencesImportSchema = z.object({
  expectedUserId: z.string().min(1),
  expectedOrgId: z.string().min(1),
  preferences: portalPreferencesSchema,
});
