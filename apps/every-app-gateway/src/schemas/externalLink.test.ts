import { describe, expect, it } from "vitest";
import { externalLinkFormSchema } from "./externalLink";

describe("external link input", () => {
  it("accepts and canonicalizes a public HTTPS URL", () => {
    expect(
      externalLinkFormSchema.parse({
        name: " Risk ",
        url: "https://EXAMPLE.org:443/a",
      }),
    ).toEqual({ name: "Risk", url: "https://example.org/a" });
  });
  it.each([
    "http://example.org",
    "javascript:alert(1)",
    "//example.org",
    "https://user:pass@example.org",
    "https://localhost/a",
    "https://127.0.0.1",
    "https://10.1.2.3",
    "https://[::1]",
    "https://example.org\\@evil.org",
    "https://example.org/%0a",
  ])("rejects unsafe URL %s", (url) => {
    expect(() => externalLinkFormSchema.parse({ name: "Risk", url })).toThrow();
  });
  it("requires a nonblank label", () => {
    expect(() =>
      externalLinkFormSchema.parse({ name: "  ", url: "https://example.org" }),
    ).toThrow();
  });
});
