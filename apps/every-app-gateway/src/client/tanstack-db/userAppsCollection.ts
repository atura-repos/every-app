import { createCollection } from "@tanstack/react-db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { queryClient } from "./queryClient";
import type { UserAccessApp } from "@/types/app";
import { getMyApps } from "@/serverFunctions/apps";
import { lazyInitForWorkers } from "@/utils/lazyInitForWorkers";

/**
 * Collection of apps the current user has access to.
 * Read-only - app management is done by owners and admins through the admin panel.
 */
export const userAppsCollection = lazyInitForWorkers(() =>
  createCollection(
    queryCollectionOptions({
      queryKey: ["user-apps"],
      meta: { persist: false },
      queryFn: async () => {
        const result = await getMyApps();
        // Existing route refreshes of this collection must also refresh the
        // identity-scoped authorization query used by the launcher.
        void queryClient.invalidateQueries({
          queryKey: ["user-apps"],
          predicate: (query) => query.queryKey.length > 1,
        });
        return result.apps;
      },
      queryClient,
      getKey: (item: UserAccessApp) => item.id,

      // Note: Insert, update, and delete are not supported.
      // App management is owners' and admins' through the admin panel.
    }),
  ),
);
