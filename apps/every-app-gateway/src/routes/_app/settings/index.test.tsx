import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  setLayout: vi.fn(),
  session: {
    user: { id: "member-1", email: "member@atura.nl" },
    session: { activeOrganizationId: "org-1" },
  },
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("@/client/hooks/useSession", () => ({
  useSession: () => ({ data: mocks.session }),
}));
vi.mock("@/client/components/PersonalLinks", () => ({
  PersonalLinks: ({ links }: { links: { name: string }[] }) => (
    <div>Add a personal link {links.map((link) => link.name).join(", ")}</div>
  ),
}));
vi.mock("@/client/hooks/usePersonalLinks", () => ({
  usePersonalLinks: () => ({
    data: [{ id: "link-1", name: "My docs", url: "https://example.org/" }],
    isError: false,
  }),
}));
vi.mock("@/client/hooks/useAppLibrary", () => ({
  AppLibraryLayout: { Grid: "grid", List: "list" },
  useAppLibrary: () => ({
    layout: "grid",
    setLayout: mocks.setLayout,
    isLoading: false,
    isError: false,
  }),
}));
import { Route } from "./index";

it("gives a regular member a personal settings hub separate from workspace administration", () => {
  const Page = (
    Route as unknown as { options: { component: React.ComponentType } }
  ).options.component;
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Page />
    </QueryClientProvider>,
  );
  expect(html).toContain("Personal settings");
  expect(html).toContain("Add a personal link");
  expect(html).toContain("My docs");
  expect(html).toContain("Grid view");
  expect(html).toContain("List view");
  expect(html).toContain("Theme");
  expect(html).toContain("System");
  expect(html).toContain('href="/settings/accounts"');
  expect(html).toContain('href="/settings/connections"');
  expect(html).not.toContain("Manage workspace");
});
