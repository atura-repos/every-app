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
export const externalLinkUpdateSchema = externalLinkFormSchema.extend({
  id: z.string().uuid(),
});
export const externalLinkDeleteSchema = z.object({ id: z.string().uuid() });
