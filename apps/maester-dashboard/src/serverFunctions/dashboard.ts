import { createServerFn } from "@tanstack/react-start";
import { ensureUserMiddleware } from "@every-app/sdk/tanstack-start";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { listTenants, readDashboard, selectTenant } from "@/server/dashboard";

const search = z
  .object({
    tenant: z.string().min(1).max(128).optional(),
    suite: z.enum(["daily", "cis"]).default("daily"),
  })
  .strict();

export const getDashboard = createServerFn()
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => search.parse(data))
  .handler(async ({ context: { user }, data }) => {
    const config = {
      PILOT_USER_ID: env.PILOT_USER_ID,
      PILOT_ORG_ID: env.PILOT_ORG_ID,
    };
    const tenants = await listTenants(user, config);
    const selectedTenant = selectTenant(tenants, data.tenant);
    const { runs, comparisons } = await readDashboard(
      user,
      config,
      selectedTenant,
      data.suite,
    );
    return { tenants, selectedTenant, suite: data.suite, runs, comparisons };
  });
