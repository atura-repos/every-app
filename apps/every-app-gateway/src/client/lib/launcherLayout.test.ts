import { describe, expect, it } from "vitest";
import {
  moveLauncherItem,
  removeCollection,
  resetLauncher,
} from "./launcherLayout";
const prefs = {
  pinnedIds: ["personal:a"],
  orderedIds: ["personal:a", "external:b", "managed:c"],
  layout: "list" as const,
  collections: [{ id: "c1", name: "Daily" }],
  assignments: { "personal:a": "c1", "external:b": "c1" },
};
describe("launcher presentation operations", () => {
  it("reorders only within a visible section without changing pin membership", () => {
    expect(
      moveLauncherItem(
        prefs,
        ["personal:a", "external:b", "managed:c"],
        "personal:a",
        1,
        ["personal:a"],
      ),
    ).toBe(prefs);
    expect(
      moveLauncherItem(
        prefs,
        ["personal:a", "external:b", "managed:c"],
        "external:b",
        1,
        ["external:b", "managed:c"],
      ).orderedIds,
    ).toEqual(["personal:a", "managed:c", "external:b"]);
  });
  it("reorders pinned items without changing pin membership or collection assignment", () => {
    const twoPinned = {
      ...prefs,
      pinnedIds: ["personal:a", "external:b"],
    };
    const moved = moveLauncherItem(
      twoPinned,
      ["personal:a", "external:b", "managed:c"],
      "personal:a",
      1,
      ["personal:a", "external:b"],
    );
    expect(moved.pinnedIds).toEqual(["external:b", "personal:a"]);
    expect(moved.assignments).toEqual(twoPinned.assignments);
  });
  it("reorders migrated raw managed IDs without creating duplicate positions", () => {
    const legacy = { ...prefs, orderedIds: ["a", "b"], pinnedIds: [] };
    const moved = moveLauncherItem(
      legacy,
      ["managed:a", "managed:b"],
      "managed:a",
      1,
      ["managed:a", "managed:b"],
    );
    expect(moved.orderedIds).toEqual(["managed:b", "managed:a"]);
  });
  it("deleting a collection retains items and pins", () => {
    expect(removeCollection(prefs, "c1")).toMatchObject({
      pinnedIds: ["personal:a"],
      collections: [],
      assignments: {},
    });
  });
  it("reset clears presentation, not links", () => {
    expect(resetLauncher(prefs)).toEqual({
      pinnedIds: [],
      orderedIds: [],
      layout: "grid",
      collections: [],
      assignments: {},
    });
  });
});
