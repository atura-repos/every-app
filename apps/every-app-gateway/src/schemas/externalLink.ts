import { z } from "zod";

/** Navigation only: never an app deployment or an Access policy change. */
export const externalLinkFormSchema = z.object({
  name: z.string().trim().min(1).max(120),
  access: z
    .object({
      everyone: z.boolean(),
      userIds: z.array(z.string().min(1)).max(500),
      groupIds: z.array(z.string().min(1)).max(500),
    })
    .optional(),
  url: z
    .string()
    .trim()
    .max(2048)
    .transform((value, ctx) => {
      try {
        // Require an explicit absolute HTTPS URL, not a browser-relative URL.
        if (
          !/^https:\/\//i.test(value) ||
          /[\\\u0000-\u001f\u007f]|%0[ad]/i.test(value)
        )
          throw new Error();
        const url = new URL(value);
        const host = url.hostname.toLowerCase().replace(/\.$/, "");
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          !host ||
          host === "localhost" ||
          host.endsWith(".localhost") ||
          host.endsWith(".local") ||
          host.endsWith(".internal") ||
          host.endsWith(".test") ||
          host.startsWith("[") || // Disallow IPv6, including loopback/private ranges.
          /^\d+\.\d+\.\d+\.\d+$/.test(host) || // Avoid private and alternate IP notation.
          !host.includes(".")
        )
          throw new Error();
        return url.href;
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "Enter a public HTTPS URL without credentials",
        });
        return z.NEVER;
      }
    }),
});
// Personal bookmarks retain the existing policy. Organization publication is stricter.
const accessSchema = externalLinkFormSchema.shape.access.unwrap();
const organizationUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .transform((value, ctx) => {
    try {
      if (
        !/^https:\/\//i.test(value) ||
        /[\\\u0000-\u001f\u007f]|%0[ad]/i.test(value)
      )
        throw new Error();
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/\.$/, "");
      if (
        url.protocol !== "https:" ||
        url.port ||
        url.username ||
        url.password ||
        !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) ||
        host
          .split(".")
          .some((part) => part.startsWith("-") || part.endsWith("-")) ||
        host === "localhost" ||
        /\.(?:localhost|local|localdomain|internal|intranet|private|test|invalid|example|home|lan|corp|onion|arpa)$/.test(
          host,
        ) ||
        (/^\d/.test(host) && /^(?:\d+\.)+\d+$/.test(host)) ||
        [...url.searchParams.keys()].some((key) =>
          /token|secret|password|passwd|pwd|apikey|auth|credential|signature|jwt|session|samlresponse|code|(?:^|[_-])(?:key|sig|sso)(?:$|[_-])/i.test(
            key,
          ),
        )
      )
        throw new Error();
      return url.href;
    } catch {
      ctx.addIssue({
        code: "custom",
        message:
          "Use a public HTTPS destination without credentials, secret query parameters, or a custom port",
      });
      return z.NEVER;
    }
  });
export const organizationExternalLinkCreateSchema = z.object({
  name: externalLinkFormSchema.shape.name,
  url: organizationUrlSchema,
  access: accessSchema,
});
export const externalLinkUpdateSchema = z
  .object({
    id: z.string().uuid(),
    name: externalLinkFormSchema.shape.name,
    // Keep legacy destinations editable without republishing them through create validation.
    url: z.string().trim().min(1).max(2048),
    access: accessSchema.optional(),
    confirmedHostname: z.string().trim().min(1).max(253),
  })
  .superRefine((data, ctx) => {
    try {
      if (
        new URL(data.url).hostname.toLowerCase().replace(/\.$/, "") ===
        data.confirmedHostname.toLowerCase()
      )
        return;
    } catch {
      /* invalid destination */
    }
    ctx.addIssue({
      code: "custom",
      path: ["confirmedHostname"],
      message: "Confirm the destination hostname",
    });
  });
export const validateOrganizationUrl = (url: string) =>
  organizationUrlSchema.parse(url);
export const externalLinkDeleteSchema = z.object({ id: z.string().uuid() });
