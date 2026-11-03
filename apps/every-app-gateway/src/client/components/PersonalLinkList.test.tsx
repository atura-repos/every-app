import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonalLinkList } from "./PersonalLinkList";
it("labels personal destinations and opens them without opener or referrer", () => {
  const html = renderToStaticMarkup(
    <PersonalLinkList
      links={[{ id: "id", name: "My docs", url: "https://example.org/" }]}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  expect(html).toContain("Personal links");
  expect(html).toContain('target="_blank"');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).toContain("My docs");
});

it("shows personal links on the launcher without editing controls", () => {
  const html = renderToStaticMarkup(
    <PersonalLinkList
      links={[{ id: "id", name: "My docs", url: "https://example.org/" }]}
    />,
  );
  expect(html).toContain("My docs");
  expect(html).not.toContain(">Edit<");
  expect(html).not.toContain(">Delete<");
});
