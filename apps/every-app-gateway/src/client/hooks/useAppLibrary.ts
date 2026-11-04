import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getErrorCode } from "@/client/errors";
import { useSession } from "@/client/hooks/useSession";
import {
  DEPLOYING_POLL_MS,
  hasDeployingApp,
  isMcpApp,
} from "@/client/lib/appStatus";
import { userAppsCollection } from "@/client/tanstack-db";
import { getMyApps } from "@/serverFunctions/apps";
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
  const session = useSession();
  const userId = session.data?.user.id;
  const orgId = session.data?.session.activeOrganizationId;
  const validated =
    session.isFetchedAfterMount && !session.isFetching && !session.error;
  const key = ["portal-preferences", userId, orgId];
  const client = useQueryClient();
  const [conflictAccount, setConflictAccount] = useState("");
  const conflictDraft = useRef<PortalPreferences | null>(null);
  const identity =
    userId && orgId ? ["portal-preferences", userId, orgId] : null;
  const account = identity?.join(":") ?? "";
  // Query functions may outlive the render/session that started them.
  const currentAccount = useRef(account);
  currentAccount.current = account;
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
    conflictDraft.current = null;
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
    enabled:
      typeof window !== "undefined" && Boolean(userId && orgId && validated),
    meta: { persist: false },
    queryFn: async () => {
      const existing = await getPortalPreferences();
      if (existing) return existing;
      if (!userId || !orgId || currentAccount.current !== account)
        return emptyPortalPreferences;
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
      if (currentAccount.current !== account) return emptyPortalPreferences;
      const imported = await importPortalPreferences({
        data: {
          expectedUserId: userId,
          expectedOrgId: orgId,
          preferences: legacy ?? emptyPortalPreferences,
        },
      });
      // Failed imports keep the local copy; concurrent devices cannot overwrite
      // an already established server row (INSERT IGNORE returns that row).
      if (legacy && currentAccount.current === account) {
        try {
          window.localStorage.removeItem(storageKey);
        } catch {
          /* safe to retry */
        }
      }
      return imported;
    },
  });
  // Read the ACL result per identity, rather than the shared collection's
  // unscoped rows. A failed refetch may leave old data in React Query.
  const appsQuery = useQuery({
    queryKey: ["user-apps", userId, orgId],
    enabled: Boolean(userId && orgId && validated),
    meta: { persist: false },
    queryFn: async () => (await getMyApps()).apps,
  });
  const authorized =
    validated &&
    appsQuery.isFetchedAfterMount &&
    !appsQuery.isFetching &&
    !appsQuery.isError
      ? appsQuery.data
      : undefined;
  const preferences =
    validated &&
    preferencesQuery.isFetchedAfterMount &&
    !preferencesQuery.isFetching &&
    !preferencesQuery.isError &&
    authorized
      ? (preferencesQuery.data ?? emptyPortalPreferences)
      : emptyPortalPreferences;
  const isLoading =
    !validated ||
    (!appsQuery.isError && !authorized) ||
    (!preferencesQuery.isError &&
      (!preferencesQuery.isFetchedAfterMount || preferencesQuery.isFetching));
  const pinnedIds = useMemo(
    () => new Set(preferences.pinnedIds),
    [preferences.pinnedIds],
  );
  // Only sort authorized rows; a saved preference never reintroduces a revoked app.
  const apps = useMemo(
    () =>
      isLoading || !authorized || preferencesQuery.isError
        ? []
        : orderAuthorizedApps([...authorized], preferences),
    [isLoading, authorized, preferences, preferencesQuery.isError],
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
    if (
      !identity ||
      conflictAccount === account ||
      !authorized ||
      !validated ||
      preferencesQuery.isFetching ||
      !preferencesQuery.isFetchedAfterMount ||
      preferencesQuery.isError ||
      !preferencesQuery.data
    )
      return;
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
          const saved = await savePortalPreferences({
            data: {
              pinnedIds: value.pinnedIds,
              orderedIds: value.orderedIds,
              layout: value.layout,
              expectedRevision: queue.confirmed?.revision ?? 0,
            },
          });
          queue.confirmed = {
            ...value,
            revision: saved?.revision ?? (queue.confirmed?.revision ?? 0) + 1,
          };
          if (!queue.pending && currentAccount.current === account)
            client.setQueryData(identity, queue.confirmed);
        } catch (error) {
          if (getErrorCode(error) === "PORTAL_PREFERENCES_CONFLICT") {
            conflictDraft.current = queue.pending ?? value;
            queue.pending = null;
            if (currentAccount.current === account) setConflictAccount(account);
          } else {
            toast.error("Could not save your app preferences.");
          }
          if (queue.confirmed && currentAccount.current === account) {
            client.setQueryData(identity, queue.confirmed);
          }
        }
      }
      queue.running = false;
    })();
  };
  const resolveConflict = async (reapply: boolean) => {
    if (!identity || conflictAccount !== account) return;
    const draft = conflictDraft.current;
    try {
      const latest = await getPortalPreferences();
      if (currentAccount.current !== account || !latest) return;
      saves.current.confirmed = latest;
      client.setQueryData(identity, latest);
      if (reapply && draft) {
        const saved = await savePortalPreferences({
          data: {
            pinnedIds: draft.pinnedIds,
            orderedIds: draft.orderedIds,
            layout: draft.layout,
            expectedRevision: latest.revision ?? 0,
          },
        });
        if (currentAccount.current !== account) return;
        client.setQueryData(identity, saved);
        saves.current.confirmed = saved;
      }
      conflictDraft.current = null;
      setConflictAccount("");
    } catch (error) {
      if (getErrorCode(error) !== "PORTAL_PREFERENCES_CONFLICT")
        toast.error("Could not reload your app preferences.");
    }
  };
  return {
    conflict: conflictAccount === account,
    reloadConflict: () => resolveConflict(false),
    reapplyConflict: () => resolveConflict(true),
    apps,
    isLoading,
    isError: appsQuery.isError || preferencesQuery.isError,
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
        const ordered = orderAuthorizedApps([...apps], current);
        const app = ordered.find((candidate) => candidate.id === appId);
        if (!app) return current;
        const section = ordered.filter(
          (candidate) => isMcpApp(candidate) === isMcpApp(app),
        );
        const index = section.findIndex((candidate) => candidate.id === appId);
        const neighbor = section[index + direction]?.id;
        if (index < 0 || !neighbor) return current;
        const otherSection = ordered.filter(
          (candidate) => isMcpApp(candidate) !== isMcpApp(app),
        );
        const sectionIds = section.map((candidate) => candidate.id);
        [sectionIds[index], sectionIds[index + direction]] = [neighbor, appId];
        const ids = isMcpApp(app)
          ? [...otherSection.map((candidate) => candidate.id), ...sectionIds]
          : [...sectionIds, ...otherSection.map((candidate) => candidate.id)];
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
