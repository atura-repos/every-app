import type { PortalPreferences } from "@/server/repositories/PersonalPortalRepository";

export type LauncherKind = "managed" | "external" | "personal";
export type LauncherSource = {
  kind: LauncherKind;
  id: string;
  name: string;
  description: string;
  url?: string;
};
export type LauncherItem = LauncherSource & {
  key: `${LauncherKind}:${string}`;
};
export type LauncherSection = {
  id: string;
  name: string;
  items: LauncherItem[];
};

/** Sources must already be authorized by their own server functions. Never hydrate items from saved keys. */
export function projectLauncher(
  sources: LauncherSource[],
  preferences: PortalPreferences,
  search = "",
  filter: "all" | "pinned" | LauncherKind | "links" = "all",
): { items: LauncherItem[]; sections: LauncherSection[]; count: number } {
  const seen = new Set<string>();
  const query = search.trim().toLocaleLowerCase();
  const normalize = (key: string) =>
    key.includes(":") ? key : `managed:${key}`;
  const order = new Map(
    preferences.orderedIds.map((key, index) => [normalize(key), index]),
  );
  const pinnedKeys = preferences.pinnedIds.map(normalize);
  const pinned = new Set(pinnedKeys);
  const items = sources
    .flatMap((source): LauncherItem[] => {
      const key = `${source.kind}:${source.id}` as LauncherItem["key"];
      if (seen.has(key)) return [];
      seen.add(key);
      if (
        query &&
        !`${source.name} ${source.description}`
          .toLocaleLowerCase()
          .includes(query)
      )
        return [];
      if (filter === "pinned" && !pinned.has(key)) return [];
      if (filter === "links" && source.kind === "managed") return [];
      if (
        filter !== "all" &&
        filter !== "pinned" &&
        filter !== "links" &&
        source.kind !== filter
      )
        return [];
      return [{ ...source, key }];
    })
    .sort(
      (a, b) =>
        (order.get(a.key) ?? Infinity) - (order.get(b.key) ?? Infinity) ||
        a.name.localeCompare(b.name) ||
        a.key.localeCompare(b.key),
    );
  if (query || filter !== "all")
    return {
      items,
      sections: [{ id: "results", name: "Results", items }],
      count: items.length,
    };
  const unpinned = items.filter((item) => !pinned.has(item.key));
  const sections: LauncherSection[] = [
    {
      id: "pinned",
      name: "Pinned",
      items: items
        .filter((item) => pinned.has(item.key))
        .sort((a, b) => pinnedKeys.indexOf(a.key) - pinnedKeys.indexOf(b.key)),
    },
    ...(preferences.collections ?? []).map((collection) => ({
      id: collection.id,
      name: collection.name,
      items: unpinned.filter(
        (item) => preferences.assignments?.[item.key] === collection.id,
      ),
    })),
    {
      id: "other",
      name: "Other",
      items: unpinned.filter(
        (item) =>
          !(preferences.collections ?? []).some(
            (collection) =>
              collection.id === preferences.assignments?.[item.key],
          ),
      ),
    },
  ];
  return { items, sections, count: items.length };
}
