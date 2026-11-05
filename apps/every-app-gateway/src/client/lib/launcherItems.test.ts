import { describe, expect, it } from "vitest";
import { projectLauncher, type LauncherSource } from "./launcherItems";

const source = (
  kind: LauncherSource["kind"],
  id: string,
  name: string,
  description = "",
  url = "https://example.org/private?secret=value",
): LauncherSource => ({ kind, id, name, description, url });

describe("authorized launcher projection", () => {
  const items = [
    source("managed", "same", "Editor"),
    source("external", "same", "Company", "Company site"),
    source("personal", "same", "My link", "Notes"),
  ];
  it("keeps colliding source IDs distinct and never searches private URLs", () => {
    expect(
      projectLauncher(
        items,
        {
          pinnedIds: [],
          orderedIds: [],
          collections: [],
          assignments: {},
          layout: "grid",
        },
        "secret",
      ).items,
    ).toEqual([]);
    expect(
      projectLauncher(
        items,
        {
          pinnedIds: [],
          orderedIds: [],
          collections: [],
          assignments: {},
          layout: "grid",
        },
        "notes",
      ).items.map((x) => x.key),
    ).toEqual(["personal:same"]);
    expect(
      projectLauncher(items, {
        pinnedIds: [],
        orderedIds: [],
        collections: [],
        assignments: {},
        layout: "grid",
      }).items.map((x) => x.key),
    ).toEqual(["external:same", "managed:same", "personal:same"]);
  });
  it("places a pin once, retaining its collection assignment for unpinning", () => {
    const prefs = {
      pinnedIds: ["external:same"],
      orderedIds: [],
      collections: [{ id: "c1", name: "Daily" }],
      assignments: { "external:same": "c1" },
      layout: "grid" as const,
    };
    const result = projectLauncher(items, prefs);
    expect(
      result.sections.map((x) => [x.name, x.items.map((i) => i.key)]),
    ).toEqual([
      ["Pinned", ["external:same"]],
      ["Daily", []],
      ["Other", ["managed:same", "personal:same"]],
    ]);
    expect(
      projectLauncher(items, { ...prefs, pinnedIds: [] }).sections[1].items.map(
        (i) => i.key,
      ),
    ).toEqual(["external:same"]);
  });
  it("maps existing managed pins and ordering without losing their order", () => {
    const result = projectLauncher(
      [source("managed", "b", "Beta"), source("managed", "a", "Alpha")],
      { pinnedIds: ["b"], orderedIds: ["b", "a"], layout: "grid" },
    );
    expect(result.sections[0].items.map((i) => i.key)).toEqual(["managed:b"]);
    expect(result.sections[1].items.map((i) => i.key)).toEqual(["managed:a"]);
  });
  it("does not resurrect revoked keys from preferences", () => {
    const result = projectLauncher([], {
      pinnedIds: ["external:same"],
      orderedIds: ["external:same"],
      collections: [],
      assignments: {},
      layout: "grid",
    });
    expect(result.items).toEqual([]);
    expect(result.count).toBe(0);
  });
});
