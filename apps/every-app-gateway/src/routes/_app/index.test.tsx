// @vitest-environment happy-dom
import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserAccessApp } from "@/types/app";

const state = vi.hoisted(() => ({
  apps: [] as UserAccessApp[],
  loading: false,
  error: false,
  personalError: false,
  externalError: false,
  userId: "alice",
  orgId: "one",
  personalLinks: [] as { id: string; name: string; url: string }[],
  externalLinks: [] as { id: string; name: string; url: string }[],
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useSearch: () => ({}),
  }),
  useNavigate: () => vi.fn(),
  Link: () => null,
}));
vi.mock("@/client/hooks/useSession", () => ({
  useSession: () => ({
    isPending: false,
    data: {
      user: { id: state.userId },
      session: { activeOrganizationId: state.orgId },
    },
  }),
}));
vi.mock("@/client/auth-client", () => ({
  authClient: {
    useActiveMemberRole: () => ({ data: { role: "member" }, isPending: false }),
  },
}));
vi.mock("@/client/hooks/useAppLibrary", () => ({
  AppLibraryLayout: { Grid: "grid", List: "list" },
  useAppLibrary: () => ({
    apps: state.apps,
    isLoading: state.loading,
    isError: state.error,
    pinnedIds: new Set(),
    layout: "grid",
    preferences: {
      pinnedIds: [],
      orderedIds: [],
      layout: "grid",
      collections: [],
      assignments: {},
    },
    updateLauncher: vi.fn(),
    setLayout: vi.fn(),
    moveApp: vi.fn(),
    conflict: false,
    reloadConflict: vi.fn(),
    reapplyConflict: vi.fn(),
  }),
}));
vi.mock("@/client/hooks/usePersonalLinks", () => ({
  usePersonalLinks: () => ({
    data: state.personalLinks,
    isError: state.personalError,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/client/hooks/useExternalLinks", () => ({
  useExternalLinks: () => ({
    data: state.externalLinks,
    isError: state.externalError,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/client/hooks/useSetupDialog", () => ({
  useSetupDialog: () => ({ app: null, open: vi.fn(), close: vi.fn() }),
}));
vi.mock("@/client/hooks/useSetupParam", () => ({
  useSetupParam: vi.fn(),
  useMcpParam: vi.fn(),
}));
vi.mock("@/client/hooks/useShortcutLabel", () => ({
  useShortcutLabel: () => "K",
}));
vi.mock("@/client/tanstack-db", () => ({
  userAppsCollection: { utils: { refetch: vi.fn() } },
}));
vi.mock("@/client/components/AppListItem", () => ({
  AppListItem: ({
    app,
    onUseMcp,
  }: {
    app: UserAccessApp;
    onUseMcp: () => void;
  }) => <button onClick={onUseMcp}>Use {app.name}</button>,
  AppListItemSkeleton: () => null,
}));
vi.mock("@/client/components/McpAppDialog", () => ({
  McpAppDialog: ({ name }: { name: string }) => <div role="dialog">{name}</div>,
}));
vi.mock("@/client/components/PageHeader", () => ({
  PageHeader: () => null,
  SectionHeader: () => null,
}));
vi.mock("@/client/components/SegmentedToggle", () => ({
  SegmentedToggle: () => null,
  SegmentedToggleSize: { Toolbar: "toolbar" },
}));
vi.mock("@/client/components/ui/input-group", () => ({
  InputGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  InputGroupAddon: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  InputGroupButton: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  InputGroupInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));
vi.mock("@/client/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/client/components/ui/badge", () => ({ Badge: () => null }));
vi.mock("@/client/components/ui/kbd", () => ({ Kbd: () => null }));
vi.mock("@/client/components/onboarding/AppGallery", () => ({
  AppGallery: () => null,
}));
vi.mock("@/client/components/LauncherPersonalLinks", () => ({
  LauncherPersonalLinks: ({ links }: { links: { name: string }[] }) => (
    <div>
      {links.map((link) => (
        <span key={link.name}>{link.name}</span>
      ))}
    </div>
  ),
}));
vi.mock("@/client/components/ExternalLinkList", () => ({
  ExternalLinkList: ({ links }: { links: { name: string }[] }) => (
    <div>
      {links.map((link) => (
        <span key={link.name}>{link.name}</span>
      ))}
    </div>
  ),
}));
import { Route } from "./index";
const Page = (Route as unknown as { options: { component: ComponentType } })
  .options.component;
let root: Root;
let container: HTMLDivElement;
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const app = {
  id: "row-a",
  appId: "mcp-a",
  name: "Search MCP",
  description: "Agent tools",
  organizationId: "one",
  tier: "provider",
  status: "active",
  hostname: null,
  isDefault: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  grantedAt: new Date(),
  via: null,
  icon: null,
  setup: { ready: true },
  paused: false,
} as unknown as UserAccessApp;

beforeEach(() => {
  state.apps = [app];
  state.loading = false;
  state.error = false;
  state.personalError = false;
  state.externalError = false;
  state.userId = "alice";
  state.orgId = "one";
  state.personalLinks = [];
  state.externalLinks = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render() {
  await act(async () => root.render(<Page />));
}
async function openMcp() {
  await render();
  await act(async () => {
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Use Search MCP")!
      .click();
  });
  expect(container.querySelector('[role="dialog"]')?.textContent).toBe(
    "Search MCP",
  );
}

it("hides and clears the selected MCP dialog when authorization refetch fails", async () => {
  await openMcp();
  state.loading = true;
  state.apps = [];
  await render();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  state.loading = false;
  state.error = true;
  await render();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  state.error = false;
  state.apps = [app];
  await render();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it("hides a stale selected app while a failed refetch retains its old list", async () => {
  await openMcp();
  state.error = true;
  await render();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  state.error = false;
  await render();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it("closes a selected MCP dialog after revocation", async () => {
  await openMcp();
  state.apps = [];
  await render();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it("does not reopen the old selection after an account switch, even when the new account can use the same app", async () => {
  await openMcp();
  state.loading = true;
  state.apps = [];
  await render();
  state.userId = "bob";
  state.orgId = "two";
  state.loading = false;
  state.apps = [app];
  await render();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it("hides every previously authorized card when one source fails rather than showing stale data", async () => {
  state.personalLinks = [
    { id: "p", name: "Private notes", url: "https://example.org/" },
  ];
  await render();
  expect(container.textContent).toContain("Private notes");
  state.externalError = true;
  await render();
  expect(container.textContent).not.toContain("Private notes");
  expect(container.textContent).not.toContain("Use Search MCP");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "List incomplete",
  );
});

it("searches link names but not private or organization link URLs", async () => {
  state.apps = [
    { ...app, tier: "app", name: "Dashboard", description: "Reports" },
  ];
  state.personalLinks = [
    { id: "p", name: "Private portal", url: "https://secret.example/internal" },
  ];
  state.externalLinks = [
    { id: "e", name: "Team portal", url: "https://secret.example/team" },
  ];
  await render();
  const input = container.querySelector('input[type="search"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, "secret.example");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.textContent).not.toContain("Private portal");
  expect(container.textContent).not.toContain("Team portal");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, "portal");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.textContent).toContain("Private portal");
  expect(container.textContent).toContain("Team portal");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, "reports");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.textContent).toContain("Use Dashboard");
});
