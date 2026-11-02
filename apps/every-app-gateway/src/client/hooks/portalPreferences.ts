import { z } from "zod";
import type { PortalPreferences } from "@/server/repositories/PersonalPortalRepository";
const legacy = z
  .object({
    pinnedIds: z.array(z.string().min(1).max(200)).max(200),
    layout: z.enum(["grid", "list"]),
    sort: z.unknown().optional(),
  })
  .strip();
export const emptyPortalPreferences: PortalPreferences = {
  pinnedIds: [],
  orderedIds: [],
  layout: "grid",
};
export function decodeLegacyPreferences(
  raw: string | null,
): PortalPreferences | null {
  if (!raw) return null;
  try {
    const parsed = legacy.safeParse(JSON.parse(raw));
    return parsed.success
      ? {
          pinnedIds: [...new Set(parsed.data.pinnedIds)],
          orderedIds: [],
          layout: parsed.data.layout,
        }
      : null;
  } catch {
    return null;
  }
}
export function orderAuthorizedApps<T extends { id: string; name: string }>(
  apps: T[],
  prefs: PortalPreferences,
): T[] {
  const pinned = new Set(prefs.pinnedIds);
  const order = new Map(prefs.orderedIds.map((id, i) => [id, i]));
  return [...apps].sort(
    (a, b) =>
      Number(pinned.has(b.id)) - Number(pinned.has(a.id)) ||
      (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity) ||
      a.name.localeCompare(b.name),
  );
}
