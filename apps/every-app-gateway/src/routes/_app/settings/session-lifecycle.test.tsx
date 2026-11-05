// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
  hydrate,
} from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/client/auth-client", () => ({
  authClient: { getSession: mocks.getSession },
}));
vi.mock("@/serverFunctions/personalPortal", () => ({
  createPersonalLink: vi.fn(),
  updatePersonalLink: vi.fn(),
  deletePersonalLink: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/client/hooks/usePersonalLinks", () => ({
  usePersonalLinks: () => ({ data: [], isError: false, refetch: vi.fn() }),
}));
vi.mock("@/client/hooks/useAppLibrary", () => ({
  useAppLibrary: () => ({
    layout: "grid",
    preferences: {
      layout: "grid",
      pinnedIds: [],
      orderedIds: [],
      collections: [],
      assignments: {},
    },
    updateLauncher: vi.fn(),
    saveStatus: "",
    conflict: false,
    reloadConflict: vi.fn(),
    reapplyConflict: vi.fn(),
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/client/components/WorkspaceLayoutSettings", () => ({
  WorkspaceLayoutSettings: () => <div>Layout ready</div>,
}));
vi.mock("@/client/components/ThemePreferenceMenuItems", () => ({
  ThemePreferenceRadio: () => <div>Theme</div>,
}));
import { useSession } from "@/client/hooks/useSession";
import { Route } from "./index";

const Settings = (
  Route as unknown as { options: { component: React.ComponentType } }
).options.component;
const member = {
  user: { id: "member" },
  session: { activeOrganizationId: "workspace" },
};
let client: QueryClient;
let root: Root;
let element: HTMLElement;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Home() {
  useSession();
  return <div>Home</div>;
}
function mount(view: React.ReactNode) {
  element = document.createElement("div");
  document.body.appendChild(element);
  root = createRoot(element);
  act(() =>
    root.render(
      <QueryClientProvider client={client}>{view}</QueryClientProvider>,
    ),
  );
}
function unmount() {
  act(() => root.unmount());
  element.remove();
}
afterEach(() => {
  if (root) unmount();
  client?.clear();
  mocks.getSession.mockReset();
});

for (const path of ["home-to-settings", "hard-reload"] as const) {
  it(`settles the authenticated member settings after ${path} without session-refetch feedback`, async () => {
    let calls = 0;
    mocks.getSession.mockImplementation(() => {
      calls++;
      // A delayed third request bounds the failing feedback loop, rather
      // than letting synchronous test responses spin until heap exhaustion.
      return calls <= 2
        ? Promise.resolve({ data: member, error: null })
        : new Promise(() => {});
    });
    client = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 0, refetchOnMount: "always", retry: false },
      },
    });
    mount(<Home />);
    await act(tick);
    expect(client.getQueryData(["auth", "session"])).toEqual(member);
    unmount();
    if (path === "hard-reload") {
      const snapshot = dehydrate(client);
      client.clear();
      client = new QueryClient({
        defaultOptions: {
          queries: { staleTime: 0, refetchOnMount: "always", retry: false },
        },
      });
      hydrate(client, snapshot);
    }
    mount(<Settings />);
    // Let each completed request notify the observer and mount the form.
    for (let i = 0; i < 5; i++) await act(tick);
    expect(element.textContent).toContain("Add a personal link");
    expect(element.textContent).not.toContain("Checking your workspace");
    expect(mocks.getSession).toHaveBeenCalledTimes(2);
  });
}
