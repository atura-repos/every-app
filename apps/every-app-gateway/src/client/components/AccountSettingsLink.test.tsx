import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
import { AccountSettingsLink } from "./AccountSettingsLink";
it("links every account to personal settings", () => {
  const html = renderToStaticMarkup(<AccountSettingsLink />);
  expect(html).toContain('href="/settings"');
  expect(html).toContain("Personal settings");
});
