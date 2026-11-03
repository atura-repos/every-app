import {
  approveConcept,
  createConcept,
  downloadReport,
  reportStatus,
} from "./approval";
import { authorizePilot } from "./dashboard";

type User = Parameters<typeof authorizePilot>[0];
type Config = Parameters<typeof authorizePilot>[1];
type Bindings = Config & { REPORTS: R2Bucket };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });

// Called exclusively inside everyApp's verified-identity wrapper, before the SPA handler.
export async function handleReportRequest(
  request: Request,
  env: Bindings,
  user: User | null,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/reports") return;
  if (!user) return json({ error: "Unauthorized" }, 401);
  try {
    authorizePilot(user, env);
    const tenant = url.searchParams.get("tenant") ?? "";
    const run = url.searchParams.get("run") ?? "";
    if (!tenant || !run || tenant.length > 128 || run.length > 128)
      return json({ error: "Invalid scope" }, 400);
    if (request.method === "GET") {
      const digest = url.searchParams.get("digest");
      return digest
        ? downloadReport(
            user,
            env,
            env.REPORTS,
            tenant,
            run,
            digest,
            url.searchParams.get("preview") === "1",
          )
        : json(await reportStatus(user, env, tenant, run));
    }
    if (request.method !== "POST")
      return json({ error: "Method not allowed" }, 405);
    if (request.headers.get("origin") !== url.origin)
      return json({ error: "Origin denied" }, 403);
    if (request.headers.get("content-type") !== "application/json")
      return json({ error: "Invalid content type" }, 415);
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      return json({ error: "Invalid request" }, 400);
    const action = (body as Record<string, unknown>).action;
    if (action === "concept")
      return json(await createConcept(user, env, env.REPORTS, tenant, run));
    const digest = (body as Record<string, unknown>).digest;
    if (action === "approve" && typeof digest === "string")
      return json(await approveConcept(user, env, tenant, run, digest));
    return json({ error: "Invalid action" }, 400);
  } catch {
    // Never reflect arbitrary source data or internal errors to unauthorised clients.
    return json({ error: "Report unavailable, stale, or access denied" }, 403);
  }
}
