import tanstackEntry from "@tanstack/react-start/server-entry";
import { everyApp } from "@every-app/sdk/server";
import { reconcile, expireImports } from "./server/ingest";

// The Gateway validates the signed identity before application routing.
// No tools or public routes are exposed by this pilot.
export default {
  ...everyApp<Env>(async (request) => tanstackEntry.fetch(request)),
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
