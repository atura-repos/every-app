import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

const QUERY_CACHE_KEY = "every-app-gateway-react-query-cache";

/**
 * Cache buster version - increment this when making breaking changes to:
 * - Database schema (migrations that change data structure)
 * - Collection query keys or data shapes
 * - Any other change that would make cached data incompatible
 *
 * This ensures users don't see stale/incompatible data after updates.
 */
export const CACHE_BUSTER = "private-query-exclusion-3";

/** Defense in depth for old callers without meta.persist=false. */
export function shouldPersistQuery(query: {
  state: { status: string };
  meta?: { persist?: boolean };
  queryKey: readonly unknown[];
}): boolean {
  const sensitive = [
    "external-links",
    "personal-links",
    "portal-preferences",
    "user-apps",
  ];
  return (
    query.state.status === "success" &&
    query.meta?.persist !== false &&
    !sensitive.includes(String(query.queryKey[0]))
  );
}

/** Shared by the provider and the persistence regression test. */
export const gatewayPersistOptions = {
  dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
};

export const persister = createSyncStoragePersister({
  storage: typeof window !== "undefined" ? window.localStorage : undefined,
  key: QUERY_CACHE_KEY,
});

/** Removes the cache's copy from localStorage: nothing stays for the next person at this browser. */
export function clearPersistedCache(): void {
  void persister.removeClient();
}
