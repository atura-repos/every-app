import type { PortalPreferences } from "@/server/repositories/PersonalPortalRepository";

/** The caller supplies only keys in the same visible section. Crossing a pin or collection boundary is never a move. */
export function moveLauncherItem(
  prefs: PortalPreferences,
  authorized: string[],
  key: string,
  direction: -1 | 1,
  section: string[],
): PortalPreferences {
  const index = section.indexOf(key);
  const neighbor = section[index + direction];
  if (
    index < 0 ||
    !neighbor ||
    !authorized.includes(key) ||
    !authorized.includes(neighbor)
  )
    return prefs;
  const ordered = [
    ...new Set([
      ...prefs.orderedIds.map((id) =>
        !id.includes(":") && authorized.includes(`managed:${id}`)
          ? `managed:${id}`
          : id,
      ),
      ...authorized,
    ]),
  ];
  const a = ordered.indexOf(key),
    b = ordered.indexOf(neighbor);
  [ordered[a], ordered[b]] = [ordered[b], ordered[a]];
  const pinnedIds = [...prefs.pinnedIds];
  const normalize = (id: string) => (id.includes(":") ? id : `managed:${id}`);
  const pinA = pinnedIds.findIndex((id) => normalize(id) === key);
  const pinB = pinnedIds.findIndex((id) => normalize(id) === neighbor);
  if (pinA !== -1 && pinB !== -1)
    [pinnedIds[pinA], pinnedIds[pinB]] = [pinnedIds[pinB], pinnedIds[pinA]];
  return { ...prefs, pinnedIds, orderedIds: ordered };
}
export function removeCollection(
  prefs: PortalPreferences,
  id: string,
): PortalPreferences {
  if (!prefs.collections?.some((c) => c.id === id)) return prefs;
  return {
    ...prefs,
    collections: prefs.collections.filter((c) => c.id !== id),
    assignments: Object.fromEntries(
      Object.entries(prefs.assignments ?? {}).filter(
        ([, value]) => value !== id,
      ),
    ),
  };
}
export function resetLauncher(_prefs: PortalPreferences): PortalPreferences {
  return {
    pinnedIds: [],
    orderedIds: [],
    layout: "grid",
    collections: [],
    assignments: {},
  };
}
