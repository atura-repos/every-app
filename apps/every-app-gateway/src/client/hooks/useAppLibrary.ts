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

type PreferenceOperation = {
  layout?: PortalPreferences["layout"];
  collections?: PortalPreferences["collections"];
  assignments?: PortalPreferences["assignments"];
  pins: { id: string; pinned: boolean }[];
  pinOrder?: string[];
  order?: string[];
  swap?: [movedId: string, neighborId: string, direction: -1 | 1];
};

function preferenceOperation(
  before: PortalPreferences,
  after: PortalPreferences,
  swap?: PreferenceOperation["swap"],
): PreferenceOperation {
  return {
    ...(before.layout !== after.layout ? { layout: after.layout } : {}),
    ...(before.collections !== after.collections
      ? { collections: after.collections }
      : {}),
    ...(before.assignments !== after.assignments
      ? { assignments: after.assignments }
      : {}),
    // A launcher move has no legacy swap argument. Preserve its explicit intent
    // for the conflict dialog, without overwriting unrelated remote fields.
    ...(!swap && before.orderedIds.join("\0") !== after.orderedIds.join("\0")
      ? { order: after.orderedIds }
      : {}),
    ...(before.pinnedIds.length === after.pinnedIds.length &&
    before.pinnedIds.every((id) => after.pinnedIds.includes(id)) &&
    before.pinnedIds.join("\0") !== after.pinnedIds.join("\0")
      ? { pinOrder: after.pinnedIds }
      : {}),
    pins: [...new Set([...before.pinnedIds, ...after.pinnedIds])]
      .filter(
        (id) => before.pinnedIds.includes(id) !== after.pinnedIds.includes(id),
      )
      .map((id) => ({ id, pinned: after.pinnedIds.includes(id) })),
    ...(swap ? { swap } : {}),
  };
}

function replayOperations(
  latest: PortalPreferences,
  operations: PreferenceOperation[],
): PortalPreferences {
  return operations.reduce((current, operation) => {
    const pinnedIds = [...current.pinnedIds];
    for (const pin of operation.pins) {
      const index = pinnedIds.indexOf(pin.id);
      if (pin.pinned && index < 0) pinnedIds.push(pin.id);
      if (!pin.pinned && index >= 0) pinnedIds.splice(index, 1);
    }
    const orderedIds = [...current.orderedIds];
    if (operation.swap) {
      const [movedId, neighborId, direction] = operation.swap;
      const a = orderedIds.indexOf(movedId);
      const b = orderedIds.indexOf(neighborId);
      if (a >= 0 && b >= 0)
        [orderedIds[a], orderedIds[b]] = [orderedIds[b], orderedIds[a]];
      else if (b >= 0)
        orderedIds.splice(b + (direction === 1 ? 1 : 0), 0, movedId);
      else if (a >= 0)
        orderedIds.splice(a + (direction === 1 ? 0 : 1), 0, neighborId);
      else
        orderedIds.push(
          ...(direction === 1 ? [neighborId, movedId] : [movedId, neighborId]),
        );
    }
    return {
      ...current,
      pinnedIds: operation.pinOrder ?? pinnedIds,
      orderedIds: operation.order ?? orderedIds,
      layout: operation.layout ?? current.layout,
      collections: operation.collections ?? current.collections,
      assignments: operation.assignments ?? current.assignments,
    };
  }, latest);
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
  const conflictDraft = useRef<PreferenceOperation[] | null>(null);
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
    operations: PreferenceOperation[];
  }>({
    account: "",
    identity: null,
    pending: null,
    running: false,
    confirmed: null,
    operations: [],
  });
  if (saves.current.account !== account) {
    // Discard speculative old-account edits; only the in-flight write may land.
    const previous = saves.current;
    if (previous.identity && previous.confirmed) {
      client.setQueryData(previous.identity, previous.confirmed);
    }
    previous.pending = null;
    previous.operations = [];
    conflictDraft.current = null;
    saves.current = {
      account,
      identity,
      pending: null,
      running: false,
      confirmed: null,
      operations: [],
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
    () =>
      new Set(
        preferences.pinnedIds.map((id) =>
          id.startsWith("managed:") ? id.slice(8) : id,
        ),
      ),
    [preferences.pinnedIds],
  );
  // Only sort authorized rows; a saved preference never reintroduces a revoked app.
  const apps = useMemo(
    () =>
      isLoading || !authorized || preferencesQuery.isError
        ? []
        : orderAuthorizedApps([...authorized], {
            ...preferences,
            pinnedIds: [...pinnedIds],
            orderedIds: preferences.orderedIds
              .map((id) => (id.startsWith("managed:") ? id.slice(8) : id))
              .filter((id) => authorized.some((app) => app.id === id)),
          }),
    [isLoading, authorized, preferences, pinnedIds, preferencesQuery.isError],
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
    swap?: { current?: PreferenceOperation["swap"] },
  ) => {
    if (
      !identity ||
      (conflictAccount === account && conflictDraft.current !== null) ||
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
    queue.operations.push(preferenceOperation(current, next, swap?.current));
    // An older read must not overwrite an optimistic edit while it saves.
    void client.cancelQueries({ queryKey: identity, exact: true });
    client.setQueryData(identity, next);
    queue.pending = next;
    if (queue.running) return;
    queue.running = true;
    void (async () => {
      while (queue.pending && saves.current === queue) {
        const value = queue.pending;
        const sentOperations = queue.operations.length;
        queue.pending = null;
        try {
          const saved = await savePortalPreferences({
            data: {
              pinnedIds: value.pinnedIds,
              orderedIds: value.orderedIds,
              layout: value.layout,
              collections: value.collections,
              assignments: value.assignments,
              expectedRevision: queue.confirmed?.revision ?? 0,
            },
          });
          queue.confirmed = {
            ...value,
            revision: saved?.revision ?? (queue.confirmed?.revision ?? 0) + 1,
          };
          queue.operations.splice(0, sentOperations);
          if (
            !queue.pending &&
            saves.current === queue &&
            currentAccount.current === account
          )
            client.setQueryData(identity, queue.confirmed);
        } catch (error) {
          if (getErrorCode(error) === "PORTAL_PREFERENCES_CONFLICT") {
            if (saves.current === queue && currentAccount.current === account) {
              conflictDraft.current = [...queue.operations];
              setConflictAccount(account);
            }
            queue.operations = [];
            queue.pending = null;
          } else {
            queue.operations.splice(0, sentOperations);
            toast.error("Could not save your app preferences.");
          }
          if (
            queue.confirmed &&
            saves.current === queue &&
            currentAccount.current === account
          ) {
            client.setQueryData(identity, queue.confirmed);
          }
        }
      }
      queue.running = false;
    })();
  };
  const resolveConflict = async (reapply: boolean) => {
    if (!identity || conflictAccount !== account || !conflictDraft.current)
      return;
    const draft = conflictDraft.current;
    const queue = saves.current;
    try {
      const latest = await getPortalPreferences();
      if (
        currentAccount.current !== account ||
        saves.current !== queue ||
        !latest
      )
        return;
      queue.confirmed = latest;
      client.setQueryData(identity, latest);
      if (reapply && draft?.length) {
        const merged = replayOperations(latest, draft);
        const saved = await savePortalPreferences({
          data: {
            pinnedIds: merged.pinnedIds,
            orderedIds: merged.orderedIds,
            layout: merged.layout,
            collections: merged.collections,
            assignments: merged.assignments,
            expectedRevision: latest.revision ?? 0,
          },
        });
        if (currentAccount.current !== account || saves.current !== queue)
          return;
        client.setQueryData(identity, saved);
        queue.confirmed = saved;
      }
      if (currentAccount.current !== account || saves.current !== queue) return;
      conflictDraft.current = null;
      setConflictAccount("");
    } catch (error) {
      if (getErrorCode(error) !== "PORTAL_PREFERENCES_CONFLICT")
        toast.error("Could not reload your app preferences.");
    }
  };
  return {
    conflict: conflictAccount === account && conflictDraft.current !== null,
    reloadConflict: () => resolveConflict(false),
    reapplyConflict: () => resolveConflict(true),
    apps,
    isLoading,
    isError: appsQuery.isError || preferencesQuery.isError,
    pinnedIds,
    preferences,
    updateLauncher: update,
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
      const swap: { current?: PreferenceOperation["swap"] } = {};
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
        swap.current = [appId, neighbor, direction];
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
      }, swap);
    },
  };
}
