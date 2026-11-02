import { useEffect, useMemo, useRef } from "react";
import { useLiveQuery } from "@tanstack/react-db";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/client/hooks/useSession";
import { DEPLOYING_POLL_MS, hasDeployingApp } from "@/client/lib/appStatus";
import {
  userAppsCollection,
  useQueryFailed,
  useQueryPending,
} from "@/client/tanstack-db";
import {
  getPortalPreferences,
  importPortalPreferences,
  savePortalPreferences,
} from "@/serverFunctions/personalPortal";
import type { PortalPreferences } from "@/server/repositories/PersonalPortalRepository";
import {
  decodeLegacyPreferences,
  emptyPortalPreferences,
  orderAuthorizedApps,
} from "./portalPreferences";

export enum AppLibraryLayout {
  Grid = "grid",
  List = "list",
}

/** Preferences are read and written for the authenticated account on the server. */
export function useAppLibrary() {
  const { data: session } = useSession();
  const userId = session?.user.id;
  const orgId = session?.session.activeOrganizationId;
  const key = ["portal-preferences", userId, orgId];
  const client = useQueryClient();
  const identity =
    userId && orgId ? ["portal-preferences", userId, orgId] : null;
  const account = identity?.join(":") ?? "";
  const saves = useRef<{
    account: string;
    identity: string[] | null;
    pending: PortalPreferences | null;
    running: boolean;
    confirmed: PortalPreferences | null;
  }>({
    account: "",
    identity: null,
    pending: null,
    running: false,
    confirmed: null,
  });
  if (saves.current.account !== account) {
    // Discard speculative old-account edits; only the in-flight write may land.
    const previous = saves.current;
    if (previous.identity && previous.confirmed) {
      client.setQueryData(previous.identity, previous.confirmed);
    }
    previous.pending = null;
    saves.current = {
      account,
      identity,
      pending: null,
      running: false,
      confirmed: null,
    };
  }
  const preferencesQuery = useQuery({
    queryKey: key,
    enabled: typeof window !== "undefined" && Boolean(userId && orgId),
    queryFn: async () => {
      const existing = await getPortalPreferences();
      if (existing) return existing;
      // Read only this authenticated account's exact legacy key.
      const storageKey = `app-library:${userId}:${orgId}`;
      let legacy: PortalPreferences | null = null;
      try {
        legacy = decodeLegacyPreferences(
          window.localStorage.getItem(storageKey),
        );
      } catch {
        /* disabled storage */
      }
      const imported = await importPortalPreferences({
        data: legacy ?? emptyPortalPreferences,
      });
      // Failed imports keep the local copy; concurrent devices cannot overwrite
      // an already established server row (INSERT IGNORE returns that row).
      if (legacy) {
        try {
          window.localStorage.removeItem(storageKey);
        } catch {
          /* safe to retry */
        }
      }
      return imported;
    },
  });
  const preferences = preferencesQuery.data ?? emptyPortalPreferences;
  const query = useLiveQuery((q) => q.from({ app: userAppsCollection }));
  const failed = useQueryFailed(["user-apps"]);
  const pending = useQueryPending(["user-apps"]);
  const isLoading =
    (!query.isReady && !query.isError) || pending || preferencesQuery.isPending;
  const pinnedIds = useMemo(
    () => new Set(preferences.pinnedIds),
    [preferences.pinnedIds],
  );
  // Only sort authorized rows; a saved preference never reintroduces a revoked app.
  const apps = useMemo(
    () => (isLoading ? [] : orderAuthorizedApps([...query.data], preferences)),
    [isLoading, query.data, preferences],
  );
  const deploying = hasDeployingApp(apps);
  useEffect(() => {
    if (!deploying) return;
    const timer = window.setInterval(() => {
      void userAppsCollection.utils.refetch();
    }, DEPLOYING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [deploying]);

  const update = (
    change: (current: PortalPreferences) => PortalPreferences,
  ) => {
    if (!identity || !preferencesQuery.data) return;
    const queue = saves.current;
    const current =
      client.getQueryData<PortalPreferences>(identity) ?? preferencesQuery.data;
    if (!queue.running) queue.confirmed = current;
    const next = change(current);
    if (next === current) return;
    // An older read must not overwrite an optimistic edit while it saves.
    void client.cancelQueries({ queryKey: identity, exact: true });
    client.setQueryData(identity, next);
    queue.pending = next;
    if (queue.running) return;
    queue.running = true;
    void (async () => {
      while (queue.pending && saves.current === queue) {
        const value = queue.pending;
        queue.pending = null;
        try {
          await savePortalPreferences({ data: value });
          queue.confirmed = value;
        } catch {
          toast.error("Could not save your app preferences.");
          if (!queue.pending && queue.confirmed) {
            client.setQueryData(identity, queue.confirmed);
          }
        }
      }
      queue.running = false;
    })();
  };
  return {
    apps,
    isLoading,
    isError: query.isError || failed || preferencesQuery.isError,
    pinnedIds,
    pinnedApps: apps.filter((app) => pinnedIds.has(app.id)),
    layout: preferences.layout as AppLibraryLayout,
    setLayout: (layout: AppLibraryLayout) =>
      update((current) => ({ ...current, layout })),
    togglePin: (appId: string) => {
      if (!apps.some((app) => app.id === appId)) return;
      update((current) => ({
        ...current,
        pinnedIds: current.pinnedIds.includes(appId)
          ? current.pinnedIds.filter((id) => id !== appId)
          : [...current.pinnedIds, appId],
      }));
    },
    moveApp: (appId: string, direction: -1 | 1) => {
      update((current) => {
        const ids = orderAuthorizedApps([...query.data], current).map(
          (app) => app.id,
        );
        const index = ids.indexOf(appId);
        const neighbor = ids[index + direction];
        if (index < 0 || !neighbor) return current;
        [ids[index], ids[index + direction]] = [neighbor, appId];
        const pinned = new Set(current.pinnedIds);
        if (pinned.has(appId) !== pinned.has(neighbor)) {
          // Crossing the boundary exchanges pin status as well as position.
          if (pinned.has(appId)) {
            pinned.delete(appId);
            pinned.add(neighbor);
          } else {
            pinned.add(appId);
            pinned.delete(neighbor);
          }
        }
        return { ...current, pinnedIds: [...pinned], orderedIds: ids };
      });
    },
  };
}
