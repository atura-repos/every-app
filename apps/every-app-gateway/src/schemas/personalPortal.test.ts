import { describe, expect, it } from "vitest";
import { portalPreferencesSaveSchema } from "./personalPortal";
const base = {
  pinnedIds: ["external:one"],
  orderedIds: ["external:one"],
  layout: "grid",
  expectedRevision: 1,
  collections: [{ id: "11111111-1111-4111-8111-111111111111", name: "Daily" }],
  assignments: { "external:one": "11111111-1111-4111-8111-111111111111" },
};
describe("personal collections validation", () => {
  it("accepts one collection per typed item", () =>
    expect(portalPreferencesSaveSchema.safeParse(base).success).toBe(true));
  it("rejects unknown collection assignment", () =>
    expect(
      portalPreferencesSaveSchema.safeParse({
        ...base,
        assignments: { "external:one": "absent" },
      }).success,
    ).toBe(false));
  it("rejects duplicate collection identity", () =>
    expect(
      portalPreferencesSaveSchema.safeParse({
        ...base,
        collections: [base.collections[0], base.collections[0]],
      }).success,
    ).toBe(false));
  it("rejects untyped keys, cross-source ambiguity and oversized collections", () => {
    expect(
      portalPreferencesSaveSchema.safeParse({
        ...base,
        assignments: { one: "11111111-1111-4111-8111-111111111111" },
      }).success,
    ).toBe(false);
    expect(
      portalPreferencesSaveSchema.safeParse({
        ...base,
        collections: Array.from({ length: 21 }, (_, i) => ({
          id: String(i),
          name: "A",
        })),
      }).success,
    ).toBe(false);
  });
});
