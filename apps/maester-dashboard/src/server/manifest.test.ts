import { describe, expect, it } from "vitest";
import manifest from "../../everyapp.config";

describe("pilot manifest", () => {
  it("requires private authentication on every route and owns isolated D1/R2", () => {
    expect(manifest.public ?? []).toEqual([]);
    expect(manifest.resources).toEqual({ d1: ["DB"], r2: ["REPORTS"] });
    expect(manifest.id).toBe("maester-dashboard");
    expect(manifest.secrets).toEqual(["PILOT_USER_ID", "PILOT_ORG_ID"]);
  });
});
