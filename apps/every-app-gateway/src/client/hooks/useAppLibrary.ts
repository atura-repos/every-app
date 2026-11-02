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
  const saving = useRef(false);
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

  const update = async (next: PortalPreferences) => {
    if (!userId || !orgId || !preferencesQuery.data || saving.current) return;
    saving.current = true;
    const identity = ["portal-preferences", userId, orgId];
    try {
      await savePortalPreferences({ data: next });
      client.setQueryData(identity, next);
    } catch {
      toast.error("Could not save your app preferences.");
    } finally {
      saving.current = false;
    }
  };
  return {
    apps,
    isLoading,
    isError: query.isError || failed || preferencesQuery.isError,
    pinnedIds,
    pinnedApps: apps.filter((app) => pinnedIds.has(app.id)),
    layout: preferences.layout as AppLibraryLayout,
    setLayout: (layout: AppLibraryLayout) =>
      void update({ ...preferences, layout }),
    togglePin: (appId: string) => {
      if (!apps.some((app) => app.id === appId)) return;
      void update({
        ...preferences,
        pinnedIds: pinnedIds.has(appId)
          ? preferences.pinnedIds.filter((id) => id !== appId)
          : [...preferences.pinnedIds, appId],
      });
    },
    moveApp: (appId: string, direction: -1 | 1) => {
      const ids = apps.map((app) => app.id);
      const index = ids.indexOf(appId);
      if (index < 0 || index + direction < 0 || index + direction >= ids.length)
        return;
      [ids[index], ids[index + direction]] = [
        ids[index + direction]!,
        ids[index]!,
      ];
      void update({ ...preferences, orderedIds: ids });
    },
  };
}
