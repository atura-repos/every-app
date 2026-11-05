import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { useSession } from "@/client/hooks/useSession";

const SAFE_CODES = new Set([
  "NETWORK_ERROR",
  "FETCH_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "INTERNAL_SERVER_ERROR",
  "BAD_REQUEST",
  "TIMEOUT",
  "UNKNOWN",
]);

function safeCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = error.code;
  return typeof code === "string" && SAFE_CODES.has(code) ? code : "OTHER";
}

type SessionObserver = Pick<
  ReturnType<typeof useSession>,
  "data" | "isFetchedAfterMount" | "isFetching" | "error"
>;

/** Read an existing observer/cache only; do not start links or preference requests. */
export function SettingsDiagnostics({ session }: { session: SessionObserver }) {
  const client = useQueryClient();
  const [, refresh] = useState(0);
  useEffect(
    () => client.getQueryCache().subscribe(() => refresh((n) => n + 1)),
    [client],
  );
  const userId = session.data?.user?.id;
  const orgId = session.data?.session?.activeOrganizationId;
  const queryState = (kind: string) => {
    const query = client
      .getQueryCache()
      .find({ queryKey: [kind, userId, orgId], exact: true });
    const state = query?.state;
    return {
      present: Boolean(query),
      status:
        state?.status === "success" || state?.status === "error"
          ? state.status
          : "pending",
      fetchStatus:
        state?.fetchStatus === "fetching" || state?.fetchStatus === "paused"
          ? state.fetchStatus
          : "idle",
      errorCode: safeCode(state?.error),
      errorPresent: Boolean(state?.error),
    };
  };
  const report = {
    session: {
      isFetchedAfterMount: session.isFetchedAfterMount,
      isFetching: session.isFetching,
      errorPresent: Boolean(session.error),
      errorCode: safeCode(session.error),
      userPresent: Boolean(session.data?.user),
      userIdPresent: Boolean(userId),
      activeOrganizationIdPresent: Boolean(orgId),
    },
    personalLinks: queryState("personal-links"),
    preferences: queryState("portal-preferences"),
  };
  return (
    <section
      aria-label="Staging settings diagnostics"
      className="m-4 rounded border p-3 text-xs"
    >
      <strong>Staging settings diagnostics (read-only)</strong>
      <pre className="overflow-auto whitespace-pre-wrap">
        {JSON.stringify(report, null, 2)}
      </pre>
    </section>
  );
}
