import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  setLayout: vi.fn(),
  linksError: false,
  layoutLoading: false,
  links: [{ id: "link-1", name: "My docs", url: "https://example.org/" }] as
    | { id: string; name: string; url: string }[]
    | undefined,
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
    data: mocks.links,
    isError: mocks.linksError,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/client/hooks/useAppLibrary", () => ({
  AppLibraryLayout: { Grid: "grid", List: "list" },
  useAppLibrary: () => ({
    layout: "grid",
    setLayout: mocks.setLayout,
    isLoading: mocks.layoutLoading,
    isError: false,
  }),
}));
import { Route } from "./index";

function renderSettings() {
  const Page = (
    Route as unknown as { options: { component: React.ComponentType } }
  ).options.component;
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Page />
    </QueryClientProvider>,
  );
}

it("gives a regular member a personal settings hub separate from workspace administration", () => {
  const html = renderSettings();
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

it("keeps the member's add-link entry point visible when listing links fails", () => {
  mocks.links = undefined;
  mocks.linksError = true;
  try {
    const html = renderSettings();
    expect(html).toContain("Failed to load personal links");
    expect(html).toContain("Add a personal link");
  } finally {
    mocks.links = [{ id: "link-1", name: "My docs", url: "https://example.org/" }];
    mocks.linksError = false;
  }
});

it("does not silently erase the add-link path while session validation waits", () => {
  mocks.links = undefined;
  mocks.layoutLoading = true;
  try {
    const html = renderSettings();
    expect(html).toContain("Personal links");
    expect(html).not.toContain("Failed to load personal links");
    expect(html).toContain("disabled");
    expect(html).toContain('role="status"');
  } finally {
    mocks.links = [{ id: "link-1", name: "My docs", url: "https://example.org/" }];
    mocks.layoutLoading = false;
  }
});
