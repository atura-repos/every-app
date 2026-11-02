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
export const portalPreferencesSchema = z.object({
  pinnedIds: ids,
  orderedIds: ids,
  layout: z.enum(["grid", "list"]),
});
