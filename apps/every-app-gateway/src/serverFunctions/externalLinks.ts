import { createServerFn } from "@tanstack/react-start";
import {
  organizationAdminMiddleware,
  organizationMemberMiddleware,
} from "@/middleware/auth";
import { publicErrorMiddleware } from "@/middleware/publicError";
import {
  organizationExternalLinkCreateSchema,
  externalLinkUpdateSchema,
  externalLinkDeleteSchema,
} from "@/schemas/externalLink";
import { ExternalLinkService } from "@/server/services/ExternalLinkService";

export const listExternalLinks = createServerFn()
  .middleware([publicErrorMiddleware, organizationMemberMiddleware])
  .handler(async ({ context }) => ExternalLinkService.list(context.org));

export const externalLinkAccessOptions = createServerFn()
  .middleware([publicErrorMiddleware, organizationAdminMiddleware])
  .handler(async ({ context }) => ExternalLinkService.options(context.org));

export const getExternalLinkAccess = createServerFn()
  .middleware([publicErrorMiddleware, organizationAdminMiddleware])
  .validator((data: unknown) => externalLinkDeleteSchema.parse(data))
  .handler(async ({ context, data }) =>
    ExternalLinkService.access(context.org, data.id),
  );

export const createExternalLink = createServerFn({ method: "POST" })
  .middleware([publicErrorMiddleware, organizationAdminMiddleware])
  .validator((data: unknown) =>
    organizationExternalLinkCreateSchema.parse(data),
  )
  .handler(async ({ context, data }) =>
    ExternalLinkService.create(context.org, data),
  );
export const updateExternalLink = createServerFn({ method: "POST" })
  .middleware([publicErrorMiddleware, organizationAdminMiddleware])
  .validator((data: unknown) => externalLinkUpdateSchema.parse(data))
  .handler(async ({ context, data }) =>
    ExternalLinkService.update(context.org, data),
  );
export const deleteExternalLink = createServerFn({ method: "POST" })
  .middleware([publicErrorMiddleware, organizationAdminMiddleware])
  .validator((data: unknown) => externalLinkDeleteSchema.parse(data))
  .handler(async ({ context, data }) =>
    ExternalLinkService.delete(context.org, data.id),
  );
