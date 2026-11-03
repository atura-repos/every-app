import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
import { LauncherPersonalLinks } from "./LauncherPersonalLinks";

it("shows personal destinations and a quiet settings link without the add form", () => {
  const html = renderToStaticMarkup(
    <LauncherPersonalLinks
      links={[{ id: "1", name: "My docs", url: "https://example.org/" }]}
    />,
  );
  expect(html).toContain("My docs");
  expect(html).toContain('href="/settings"');
  expect(html).not.toContain("Add a personal link");
  expect(html).not.toContain("<form");
  expect(html).not.toContain(">Delete<");
});

it("keeps the add form off the empty launcher", () => {
  const html = renderToStaticMarkup(<LauncherPersonalLinks links={[]} />);
  expect(html).not.toContain("Add a personal link");
  expect(html).not.toContain("<form");
});
