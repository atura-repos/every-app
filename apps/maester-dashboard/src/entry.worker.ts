import tanstackEntry from "@tanstack/react-start/server-entry";
import { everyApp } from "@every-app/sdk/server";
import { reconcile, expireImports } from "./server/ingest";
import { handleReportRequest } from "./server/reportEndpoint";
import { handleControlledRequest } from "./server/controlledDownload";

// Gateway validates signed identity; no public routes or tools are exposed.
export default {
  ...everyApp<Env>(
    async (request, env, _ctx, user) =>
      (await handleReportRequest(request, env, user)) ??
      (await handleControlledRequest(request, env, user)) ??
      tanstackEntry.fetch(request),
  ),
  async scheduled(_event: ScheduledEvent, env: Env) {
    // No payloads, credentials or provider response bodies in logs.
    try {
      await expireImports(env.DB, env.REPORTS);
      await reconcile(env.DB, env.REPORTS, env);
    } catch {
      throw new Error("Maester scheduled maintenance failed");
    }
  },
};
