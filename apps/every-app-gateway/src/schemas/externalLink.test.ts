import { describe, expect, it } from "vitest";
import {
  externalLinkFormSchema,
  organizationExternalLinkCreateSchema,
  externalLinkUpdateSchema,
} from "./externalLink";

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

describe("organization publication policy", () => {
  const access = { everyone: true, userIds: [], groupIds: [] };
  it("requires an explicit audience on create without changing personal links", () => {
    expect(
      externalLinkFormSchema.safeParse({
        name: "Personal",
        url: "https://example.org",
      }).success,
    ).toBe(true);
    expect(
      organizationExternalLinkCreateSchema.safeParse({
        name: "Org",
        url: "https://example.org",
      }).success,
    ).toBe(false);
    expect(
      organizationExternalLinkCreateSchema.safeParse({
        name: "Org",
        url: "https://example.org",
        access,
      }).success,
    ).toBe(true);
  });
  it.each([
    "https://example.org:8443/",
    "https://192.168.1.1/",
    "https://2130706433/",
    "https://internal.example.local/",
    "https://router.home.arpa/",
    "https://gateway.localdomain/",
    "https://user@example.org/",
    "https://example.org/?token=private-value",
    "https://example.org/?api_key=private-value",
    "https://example.org/?access_token=private-value",
  ])(
    "rejects unsafe organizational destination without echoing values",
    (url) => {
      const result = organizationExternalLinkCreateSchema.safeParse({
        name: "Org",
        url,
        access,
      });
      expect(result.success).toBe(false);
      if (!result.success)
        expect(JSON.stringify(result.error)).not.toContain("private-value");
    },
  );
  it("requires matching hostname reconfirmation on update", () => {
    const base = {
      id: crypto.randomUUID(),
      name: "Org",
      url: "https://example.org/",
    };
    expect(externalLinkUpdateSchema.safeParse(base).success).toBe(false);
    expect(
      externalLinkUpdateSchema.safeParse({
        ...base,
        confirmedHostname: "wrong.org",
      }).success,
    ).toBe(false);
    expect(
      externalLinkUpdateSchema.safeParse({
        ...base,
        confirmedHostname: "example.org",
      }).success,
    ).toBe(true);
  });
  it.each([
    "apiKey",
    "clientSecret",
    "accessToken",
    "authCode",
    "x-amz-signature",
    "SAMLResponse",
  ])("rejects secret query key %s without exposing its value", (key) => {
    const result = organizationExternalLinkCreateSchema.safeParse({
      name: "Org",
      url: `https://example.org/?${key}=private-value`,
      access,
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(JSON.stringify(result.error)).not.toContain("private-value");
  });
});
