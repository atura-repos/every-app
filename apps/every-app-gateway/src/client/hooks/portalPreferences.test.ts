import { expect, it } from "vitest";
import {
  decodeLegacyPreferences,
  orderAuthorizedApps,
} from "./portalPreferences";
it("imports only valid legacy preferences and never reads arbitrary keys", () => {
  expect(
    decodeLegacyPreferences('{"pinnedIds":["a"],"layout":"list","sort":"old"}'),
  ).toEqual({ pinnedIds: ["a"], orderedIds: [], layout: "list" });
  expect(
    decodeLegacyPreferences('{"pinnedIds":["a"],"layout":"bad"}'),
  ).toBeNull();
  expect(
    decodeLegacyPreferences(
      '{"pinnedIds":["a"],"layout":"grid","token":"secret"}',
    ),
  ).toEqual({ pinnedIds: ["a"], orderedIds: [], layout: "grid" });
});
it("orders only authorized apps, ignoring revoked or invented ids", () => {
  const apps = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ];
  expect(
    orderAuthorizedApps(apps, {
      pinnedIds: ["revoked", "b"],
      orderedIds: ["revoked", "b", "a"],
      layout: "grid",
    }).map((a) => a.id),
  ).toEqual(["b", "a"]);
});
