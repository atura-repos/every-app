import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExternalLinkList } from "./ExternalLinkList";

describe("external link navigation", () => {
  it("labels destinations as external and opens securely in a new tab", () => {
    const html = renderToStaticMarkup(
      <ExternalLinkList
        links={[
          {
            id: "a",
            name: "Risk",
            url: "https://example.org/risk",
            organizationId: "org",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]}
      />,
    );
    expect(html).toContain("External links");
    expect(html).toContain("External site");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="https://example.org/risk"');
  });
});
