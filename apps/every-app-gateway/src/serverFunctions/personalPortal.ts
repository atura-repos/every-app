import { createServerFn } from "@tanstack/react-start";
import { organizationMemberMiddleware } from "@/middleware/auth";
import { publicErrorMiddleware } from "@/middleware/publicError";
import {
  personalLinkFormSchema,
  personalLinkUpdateSchema,
  personalLinkDeleteSchema,
  portalPreferencesSchema,
  portalPreferencesImportSchema,
} from "@/schemas/personalPortal";
import { PersonalPortalService as service } from "@/server/services/PersonalPortalService";

export const listPersonalLinks = createServerFn()
  .middleware([publicErrorMiddleware, organizationMemberMiddleware])
  .handler(async ({ context }) => service.listLinks(context.org));
export const createPersonalLink = createServerFn({ method: "POST" })
  .middleware([publicErrorMiddleware, organizationMemberMiddleware])
  .validator((data: unknown) => personalLinkFormSchema.parse(data))
  .handler(async ({ context, data }) => service.createLink(context.org, data));
export const updatePersonalLink = createServerFn({ method: "POST" })
  .middleware([publicErrorMiddleware, organizationMemberMiddleware])
  .validator((data: unknown) => personalLinkUpdateSchema.parse(data))
  .handler(async ({ context, data }) => service.updateLink(context.org, data));
export const deletePersonalLink = createServerFn({ method: "POST" })
  .middleware([publicErrorMiddleware, organizationMemberMiddleware])
  .validator((data: unknown) => personalLinkDeleteSchema.parse(data))
  .handler(async ({ context, data }) =>
    service.deleteLink(context.org, data.id),
  );
export const getPortalPreferences = createServerFn()
  .middleware([publicErrorMiddleware, organizationMemberMiddleware])
  .handler(async ({ context }) => service.getPreferences(context.org));
export const savePortalPreferences = createServerFn({ method: "POST" })
  .middleware([publicErrorMiddleware, organizationMemberMiddleware])
  .validator((data: unknown) => portalPreferencesSchema.parse(data))
  .handler(async ({ context, data }) =>
    service.savePreferences(context.org, data),
  );
export const importPortalPreferences = createServerFn({ method: "POST" })
  .middleware([publicErrorMiddleware, organizationMemberMiddleware])
  .validator((data: unknown) => portalPreferencesImportSchema.parse(data))
  .handler(async ({ context, data }) => {
    if (
      data.expectedUserId !== context.org.userId ||
      data.expectedOrgId !== context.org.orgId
    ) {
      throw new Error("Portal import identity changed");
    }
    return service.importPreferences(context.org, data.preferences);
  });
