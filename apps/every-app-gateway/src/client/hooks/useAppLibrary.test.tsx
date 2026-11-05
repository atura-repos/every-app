// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PortalPreferences } from "@/server/repositories/PersonalPortalRepository";
import { importPortalPreferences } from "@/serverFunctions/personalPortal";
import { AppLibraryLayout, useAppLibrary } from "./useAppLibrary";

const state = vi.hoisted(() => ({
  account: { user: "alice", org: "one" },
  validated: true,
  fetching: false,
  sessionError: null as Error | null,
  appsFetch: vi.fn(),
  save: vi.fn(),
  get: vi.fn(),
  apps: [
    { id: "a", name: "Alpha", tier: "app" },
    { id: "b", name: "Beta", tier: "app" },
    { id: "c", name: "Charlie", tier: "app" },
  ],
}));
vi.mock("@/client/hooks/useSession", () => ({
  useSession: () => ({
    data: {
      user: { id: state.account.user },
      session: { activeOrganizationId: state.account.org },
    },
    isFetchedAfterMount: state.validated,
    isFetching: state.fetching,
    error: state.sessionError,
  }),
}));
vi.mock("@/serverFunctions/apps", () => ({ getMyApps: state.appsFetch }));
vi.mock("@/client/tanstack-db", () => ({
  userAppsCollection: { utils: { refetch: vi.fn() } },
  useQueryFailed: () => false,
}));
vi.mock("@tanstack/react-db", () => ({
  useLiveQuery: () => ({
    isReady: true,
    isError: false,
    data: state.apps,
  }),
}));
vi.mock("@/serverFunctions/personalPortal", () => ({
  getPortalPreferences: state.get,
  importPortalPreferences: vi.fn(),
  savePortalPreferences: state.save,
}));

const initial: PortalPreferences = {
  pinnedIds: ["a"],
  orderedIds: ["a", "b", "c"],
  layout: "grid",
};
let client: QueryClient;
let root: Root;
let container: HTMLElement;
let library: ReturnType<typeof useAppLibrary>;
function Harness() {
  library = useAppLibrary();
  return null;
}
function render() {
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    ),
  );
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(async () => {
  state.account = { user: "alice", org: "one" };
  state.validated = true;
  state.fetching = false;
  state.sessionError = null;
  state.appsFetch
    .mockReset()
    .mockImplementation(async () => ({ apps: state.apps }));
  state.apps = [
    { id: "a", name: "Alpha", tier: "app" },
    { id: "b", name: "Beta", tier: "app" },
    { id: "c", name: "Charlie", tier: "app" },
  ];
  vi.mocked(importPortalPreferences).mockReset();
  state.save.mockReset().mockResolvedValue(undefined);
  state.get
    .mockReset()
    .mockImplementation(async () =>
      state.account.user === "alice"
        ? { pinnedIds: ["a"], orderedIds: ["a", "b", "c"], layout: "grid" }
        : { pinnedIds: [], orderedIds: [], layout: "grid" },
    );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["portal-preferences", "alice", "one"], initial);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  render();
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(library.isLoading).toBe(false);
    expect(library.apps.map((app) => app.name)).toContain("Alpha");
  });
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  container.remove();
});

it("reports pending then confirmed, rejected, and conflicting saves from the real queue", async () => {
  let finish!: (value: unknown) => void;
  state.save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => library.updateLauncher((p) => ({ ...p, layout: "list" })));
  expect(library.saveStatus).toBe("saving");
  await act(async () => finish({ revision: 1 }));
  await vi.waitFor(() => expect(library.saveStatus).toBe("saved"));
  state.save.mockRejectedValueOnce(new Error("save failed"));
  act(() => library.updateLauncher((p) => ({ ...p, layout: "grid" })));
  await vi.waitFor(() => expect(library.saveStatus).toBe("error"));
  state.save.mockRejectedValueOnce({ code: "PORTAL_PREFERENCES_CONFLICT" });
  act(() => library.updateLauncher((p) => ({ ...p, layout: "grid" })));
  await vi.waitFor(() => expect(library.saveStatus).toBe("conflict"));
});

it("recognizes typed managed pins in the existing sidebar library", async () => {
  state.get.mockResolvedValue({
    pinnedIds: ["managed:b"],
    orderedIds: ["managed:b", "managed:a"],
    layout: "grid",
    revision: 1,
  });
  await act(async () => {
    await client.invalidateQueries({
      queryKey: ["portal-preferences", "alice", "one"],
    });
  });
  await vi.waitFor(() =>
    expect(library.pinnedApps.map((app) => app.id)).toEqual(["b"]),
  );
  expect(library.apps[0]?.id).toBe("b");
});

it("saves a collection with the same revision-safe queue as pinning", async () => {
  const collection = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Daily",
  };
  act(() =>
    library.updateLauncher((current) => ({
      ...current,
      collections: [collection],
      assignments: { "managed:a": collection.id },
    })),
  );
  await vi.waitFor(() =>
    expect(state.save).toHaveBeenCalledWith({
      data: expect.objectContaining({
        collections: [collection],
        assignments: { "managed:a": collection.id },
        expectedRevision: 0,
      }),
    }),
  );
});

it("shows conflict and reapplies only the moved typed shortcut over a remote assignment", async () => {
  const collections = [
    { id: "work", name: "Work" },
    { id: "home", name: "Home" },
  ];
  const original = {
    ...initial,
    collections,
    assignments: { "personal:1": "work", "external:2": "work" },
    revision: 4,
  };
  act(() =>
    client.setQueryData(["portal-preferences", "alice", "one"], original),
  );
  render();
  state.save.mockRejectedValueOnce({ code: "PORTAL_PREFERENCES_CONFLICT" });
  act(() =>
    library.updateLauncher((current) => ({
      ...current,
      assignments: { ...current.assignments, "personal:1": "home" },
    })),
  );
  await vi.waitFor(() => expect(library.conflict).toBe(true));
  expect(state.save).toHaveBeenCalledWith({
    data: expect.objectContaining({ expectedRevision: 4 }),
  });
  expect(library.preferences.assignments).toEqual(original.assignments);
  state.get.mockResolvedValueOnce({
    ...original,
    assignments: { "personal:1": "work", "external:2": "home" },
    revision: 5,
  });
  state.save.mockImplementationOnce(
    async ({ data }: { data: PortalPreferences }) => ({ ...data, revision: 6 }),
  );
  await act(async () => {
    await library.reapplyConflict();
  });
  expect(state.save).toHaveBeenLastCalledWith({
    data: expect.objectContaining({
      assignments: { "personal:1": "home", "external:2": "home" },
      expectedRevision: 5,
    }),
  });
  expect(library.conflict).toBe(false);
});

it("rolls a failed shortcut move back to confirmed preferences with a visible error", async () => {
  const original = {
    ...initial,
    assignments: { "personal:1": "work" },
    revision: 2,
  };
  act(() =>
    client.setQueryData(["portal-preferences", "alice", "one"], original),
  );
  render();
  state.save.mockRejectedValueOnce(new Error("offline"));
  act(() =>
    library.updateLauncher((current) => ({
      ...current,
      assignments: { "personal:1": "home" },
    })),
  );
  await vi.waitFor(() => expect(library.saveStatus).toBe("error"));
  expect(library.preferences.assignments).toEqual(original.assignments);
  expect(state.save).toHaveBeenCalledWith({
    data: expect.objectContaining({ expectedRevision: 2 }),
  });
});

it("reapplies a launcher pin-order move after a two-browser conflict", async () => {
  const pins = ["managed:a", "managed:b"];
  act(() =>
    client.setQueryData(["portal-preferences", "alice", "one"], {
      pinnedIds: pins,
      orderedIds: pins,
      layout: "grid",
      revision: 1,
    }),
  );
  render();
  state.save.mockRejectedValueOnce({ code: "PORTAL_PREFERENCES_CONFLICT" });
  act(() =>
    library.updateLauncher((current) => ({
      ...current,
      pinnedIds: ["managed:b", "managed:a"],
      orderedIds: ["managed:b", "managed:a"],
    })),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(library.conflict).toBe(true);
  state.get.mockResolvedValueOnce({
    pinnedIds: pins,
    orderedIds: pins,
    layout: "list",
    revision: 2,
  });
  state.save.mockImplementationOnce(
    async ({ data }: { data: PortalPreferences }) => ({ ...data, revision: 3 }),
  );
  await act(async () => {
    await library.reapplyConflict();
  });
  expect(state.save).toHaveBeenLastCalledWith({
    data: expect.objectContaining({
      pinnedIds: ["managed:b", "managed:a"],
      orderedIds: ["managed:b", "managed:a"],
      layout: "list",
      expectedRevision: 2,
    }),
  });
});

it("never persists preferences or managed apps in a browser snapshot", async () => {
  const { dehydrate } = await import("@tanstack/react-query");
  const snapshot = dehydrate(client, {
    shouldDehydrateQuery: (q) =>
      q.state.status === "success" && q.meta?.persist !== false,
  });
  expect(JSON.stringify(snapshot)).not.toContain("Alpha");
  expect(JSON.stringify(snapshot)).not.toContain("pinnedIds");
});

it("rejects restored managed apps and preferences on offline reload", async () => {
  client.setQueryData(
    ["user-apps", "alice", "one"],
    [{ id: "secret", name: "Old secret app", tier: "app" }],
  );
  state.appsFetch.mockRejectedValue(new Error("offline"));
  state.get.mockRejectedValue(new Error("offline"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["user-apps"] });
    await client.invalidateQueries({ queryKey: ["portal-preferences"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(library.apps).toEqual([]);
  expect(library.pinnedIds.size).toBe(0);
  expect(library.isError).toBe(true);
});

it("hides managed apps and preferences during session validation or failed access refetch", async () => {
  expect(library.apps.map((app) => app.name)).toContain("Alpha");
  state.fetching = true;
  render();
  expect(library.apps).toEqual([]);
  expect(library.pinnedIds.size).toBe(0);
  state.fetching = false;
  state.appsFetch.mockRejectedValue(new Error("revoked"));
  render();
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["user-apps"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(state.appsFetch).toHaveBeenCalled();
  expect(library.apps).toEqual([]);
  expect(library.isError).toBe(true);
});

it("does not show old workspace apps while new workspace access is checked", async () => {
  state.account.org = "two";
  state.validated = false;
  render();
  expect(library.apps).toEqual([]);
  expect(library.pinnedIds.size).toBe(0);
  state.validated = true;
  state.appsFetch.mockResolvedValueOnce({
    apps: [{ id: "z", name: "Zeta", tier: "app" }],
  });
  render();
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(library.apps.map((app) => app.name)).toEqual(["Zeta"]);
  });
  expect(library.apps.map((app) => app.name)).toEqual(["Zeta"]);
});

it("moves a pinned app across the pin boundary without a no-op", async () => {
  act(() => library.moveApp("a", 1));
  expect(client.getQueryData(["portal-preferences", "alice", "one"])).toEqual({
    pinnedIds: ["b"],
    orderedIds: ["b", "a", "c"],
    layout: "grid",
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(library.apps.map((app) => app.id)).toEqual(["b", "a", "c"]);
  expect(library.pinnedIds.has("b")).toBe(true);
  expect(library.pinnedIds.has("a")).toBe(false);
  expect(state.save).toHaveBeenCalledWith({
    data: {
      pinnedIds: ["b"],
      orderedIds: ["b", "a", "c"],
      layout: "grid",
      expectedRevision: 0,
    },
  });
});

it("does not save a move outside the visible app list", () => {
  act(() => library.moveApp("a", -1));
  expect(state.save).not.toHaveBeenCalled();
});

it("moves an unpinned app upward across the boundary", async () => {
  act(() => library.moveApp("b", -1));
  expect(client.getQueryData(["portal-preferences", "alice", "one"])).toEqual({
    pinnedIds: ["b"],
    orderedIds: ["b", "a", "c"],
    layout: "grid",
  });
});

it("moves to the next visible page app instead of swapping an MCP app", async () => {
  state.apps = [
    { id: "a", name: "Alpha", tier: "app" },
    { id: "b", name: "Beta", tier: "provider" },
    { id: "c", name: "Charlie", tier: "app" },
  ];
  state.appsFetch.mockResolvedValue({ apps: state.apps });
  render();
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["user-apps"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  act(() => library.moveApp("a", 1));
  expect(client.getQueryData(["portal-preferences", "alice", "one"])).toEqual({
    pinnedIds: ["c"],
    orderedIds: ["c", "a", "b"],
    layout: "grid",
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(
    library.apps.filter((app) => app.tier !== "provider").map((app) => app.id),
  ).toEqual(["c", "a"]);
});

it("does not import old-account legacy preferences after switching during a read", async () => {
  let finish!: (value: PortalPreferences | null) => void;
  const stale = new Promise<PortalPreferences | null>((resolve) => {
    finish = resolve;
  });
  state.get.mockReturnValueOnce(stale);
  const storage = Object.getOwnPropertyDescriptor(window, "localStorage");
  const getItem = vi
    .fn()
    .mockReturnValue(JSON.stringify({ pinnedIds: ["a"], layout: "list" }));
  const removeItem = vi.fn();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem, removeItem },
  });
  const read = client.refetchQueries({
    queryKey: ["portal-preferences", "alice", "one"],
  });
  state.account = { user: "bob", org: "two" };
  client.setQueryData(["portal-preferences", "bob", "two"], {
    pinnedIds: [],
    orderedIds: [],
    layout: "grid",
  });
  render();
  await act(async () => {
    finish(null);
    await read;
  });
  expect(importPortalPreferences).not.toHaveBeenCalled();
  expect(removeItem).not.toHaveBeenCalled();
  if (storage) Object.defineProperty(window, "localStorage", storage);
});

it("keeps the old legacy copy and new account cache when an import finishes after switching", async () => {
  const storage = Object.getOwnPropertyDescriptor(window, "localStorage");
  const removeItem = vi.fn();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi
        .fn()
        .mockReturnValue(JSON.stringify({ pinnedIds: ["a"], layout: "list" })),
      removeItem,
    },
  });
  let finish!: (value: PortalPreferences) => void;
  vi.mocked(importPortalPreferences).mockReturnValueOnce(
    new Promise<PortalPreferences>((resolve) => {
      finish = resolve;
    }) as ReturnType<typeof importPortalPreferences>,
  );
  state.get.mockResolvedValueOnce(null);
  const read = client.refetchQueries({
    queryKey: ["portal-preferences", "alice", "one"],
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(importPortalPreferences).toHaveBeenCalledWith({
    data: {
      expectedUserId: "alice",
      expectedOrgId: "one",
      preferences: { pinnedIds: ["a"], orderedIds: [], layout: "list" },
    },
  });
  const bob: PortalPreferences = {
    pinnedIds: [],
    orderedIds: [],
    layout: "grid",
  };
  client.setQueryData(["portal-preferences", "bob", "two"], bob);
  state.account = { user: "bob", org: "two" };
  render();
  await act(async () => {
    finish({ ...initial, layout: "list" });
    await read;
  });
  expect(removeItem).not.toHaveBeenCalled();
  expect(client.getQueryData(["portal-preferences", "bob", "two"])).toEqual(
    bob,
  );
  if (storage) Object.defineProperty(window, "localStorage", storage);
});

it("shows a two-browser conflict, keeps the confirmed save, and explicitly reloads/reapplies", async () => {
  state.save.mockResolvedValueOnce({ ...initial, layout: "list", revision: 1 });
  act(() => library.setLayout(AppLibraryLayout.List));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(
    client.getQueryData<PortalPreferences>([
      "portal-preferences",
      "alice",
      "one",
    ]),
  )?.toMatchObject({ layout: "list", revision: 1 });
  state.save.mockRejectedValueOnce({ code: "PORTAL_PREFERENCES_CONFLICT" });
  act(() => library.togglePin("b"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(library.conflict).toBe(true);
  expect(
    client.getQueryData<PortalPreferences>([
      "portal-preferences",
      "alice",
      "one",
    ]),
  )?.toMatchObject({ layout: "list", pinnedIds: ["a"], revision: 1 });
  state.get.mockResolvedValueOnce({ ...initial, layout: "grid", revision: 2 });
  state.save.mockResolvedValueOnce({
    ...initial,
    pinnedIds: ["a", "b"],
    revision: 3,
  });
  await act(async () => {
    await library.reapplyConflict();
  });
  expect(state.save).toHaveBeenLastCalledWith({
    data: expect.objectContaining({
      expectedRevision: 2,
      pinnedIds: ["a", "b"],
    }),
  });
  expect(library.conflict).toBe(false);
});

it("loads latest preferences on conflict without re-sending the rejected draft", async () => {
  state.save.mockRejectedValueOnce({ code: "PORTAL_PREFERENCES_CONFLICT" });
  act(() => library.setLayout(AppLibraryLayout.List));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(library.conflict).toBe(true);
  state.get.mockResolvedValueOnce({
    ...initial,
    pinnedIds: ["c"],
    revision: 2,
  });
  await act(async () => {
    await library.reloadConflict();
  });
  expect(library.conflict).toBe(false);
  expect(state.save).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(["portal-preferences", "alice", "one"])).toEqual({
    ...initial,
    pinnedIds: ["c"],
    revision: 2,
  });
});

it.each([
  ["layout", "pin"],
  ["pin", "layout"],
] as const)(
  "reapplies %s without overwriting a concurrent %s edit",
  async (local, remote) => {
    state.save.mockRejectedValueOnce({ code: "PORTAL_PREFERENCES_CONFLICT" });
    act(() =>
      local === "layout"
        ? library.setLayout(AppLibraryLayout.List)
        : library.togglePin("b"),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(library.conflict).toBe(true);
    const latest = {
      ...initial,
      revision: 2,
      ...(remote === "pin" ? { pinnedIds: ["a", "c"] } : { layout: "list" }),
    };
    state.get.mockResolvedValueOnce(latest);
    state.save.mockImplementationOnce(
      async ({ data }: { data: PortalPreferences }) => ({
        ...data,
        revision: 3,
      }),
    );
    await act(async () => {
      await library.reapplyConflict();
    });
    expect(state.save).toHaveBeenLastCalledWith({
      data: {
        pinnedIds: local === "pin" ? ["a", "b"] : ["a", "c"],
        orderedIds: initial.orderedIds,
        layout: "list",
        expectedRevision: 2,
      },
    });
    expect(library.conflict).toBe(false);
  },
);

it("replays a stale reorder as a swap, preserving concurrent order and layout", async () => {
  state.save.mockRejectedValueOnce({ code: "PORTAL_PREFERENCES_CONFLICT" });
  act(() => library.moveApp("a", 1));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(library.conflict).toBe(true);
  state.get.mockResolvedValueOnce({
    ...initial,
    orderedIds: ["a", "c", "b"],
    layout: "list",
    revision: 4,
  });
  state.save.mockImplementationOnce(
    async ({ data }: { data: PortalPreferences }) => ({ ...data, revision: 5 }),
  );
  await act(async () => {
    await library.reapplyConflict();
  });
  expect(state.save).toHaveBeenLastCalledWith({
    data: {
      pinnedIds: ["b"],
      orderedIds: ["b", "c", "a"],
      layout: "list",
      expectedRevision: 4,
    },
  });
});

it("reapplies the first move from empty order without losing remote layout or order", async () => {
  act(() => {
    client.setQueryData(["portal-preferences", "alice", "one"], {
      pinnedIds: [],
      orderedIds: [],
      layout: "grid",
    });
  });
  render();
  state.save.mockRejectedValueOnce({ code: "PORTAL_PREFERENCES_CONFLICT" });
  act(() => library.moveApp("a", 1));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(library.conflict).toBe(true);
  state.get.mockResolvedValueOnce({
    pinnedIds: [],
    orderedIds: ["a", "c", "b"],
    layout: "list",
    revision: 2,
  });
  state.save.mockImplementationOnce(
    async ({ data }: { data: PortalPreferences }) => ({ ...data, revision: 3 }),
  );
  await act(async () => {
    await library.reapplyConflict();
  });
  expect(state.save).toHaveBeenLastCalledWith({
    data: {
      pinnedIds: [],
      orderedIds: ["b", "c", "a"],
      layout: "list",
      expectedRevision: 2,
    },
  });
  expect(library.conflict).toBe(false);
});

it.each([
  { name: "only the moved app", remote: ["a", "b"], expected: ["a", "c", "b"] },
  { name: "only its neighbor", remote: ["a", "c"], expected: ["a", "c", "b"] },
  { name: "neither app", remote: ["a"], expected: ["a", "c", "b"] },
])(
  "reapplies a partial-order move when remote contains $name",
  async ({ remote, expected }) => {
    act(() => {
      client.setQueryData(["portal-preferences", "alice", "one"], {
        pinnedIds: [],
        orderedIds: ["a"],
        layout: "grid",
      });
    });
    state.save.mockRejectedValueOnce({ code: "PORTAL_PREFERENCES_CONFLICT" });
    act(() => library.moveApp("b", 1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(library.conflict).toBe(true);
    state.get.mockResolvedValueOnce({
      pinnedIds: ["a"],
      orderedIds: remote,
      layout: "list",
      revision: 2,
    });
    state.save.mockImplementationOnce(
      async ({ data }: { data: PortalPreferences }) => ({
        ...data,
        revision: 3,
      }),
    );
    await act(async () => {
      await library.reapplyConflict();
    });
    expect(state.save).toHaveBeenLastCalledWith({
      data: {
        pinnedIds: ["a"],
        orderedIds: expected,
        layout: "list",
        expectedRevision: 2,
      },
    });
    expect(library.conflict).toBe(false);
  },
);

it("retains first-move intent through repeated conflicts and a newly added remote app", async () => {
  act(() => {
    client.setQueryData(["portal-preferences", "alice", "one"], {
      pinnedIds: [],
      orderedIds: [],
      layout: "grid",
    });
  });
  state.save.mockRejectedValueOnce({ code: "PORTAL_PREFERENCES_CONFLICT" });
  act(() => library.moveApp("b", -1));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(library.conflict).toBe(true);
  state.get.mockResolvedValueOnce({
    pinnedIds: ["c"],
    orderedIds: ["c", "a"],
    layout: "list",
    revision: 2,
  });
  state.save.mockRejectedValueOnce({ code: "PORTAL_PREFERENCES_CONFLICT" });
  await act(async () => {
    await library.reapplyConflict();
  });
  expect(state.save).toHaveBeenLastCalledWith({
    data: {
      pinnedIds: ["c"],
      orderedIds: ["c", "b", "a"],
      layout: "list",
      expectedRevision: 2,
    },
  });
  expect(library.conflict).toBe(true);
  state.get.mockResolvedValueOnce({
    pinnedIds: ["c"],
    orderedIds: ["c", "d", "a"],
    layout: "list",
    revision: 3,
  });
  state.save.mockImplementationOnce(
    async ({ data }: { data: PortalPreferences }) => ({ ...data, revision: 4 }),
  );
  await act(async () => {
    await library.reapplyConflict();
  });
  expect(state.save).toHaveBeenLastCalledWith({
    data: {
      pinnedIds: ["c"],
      orderedIds: ["c", "d", "b", "a"],
      layout: "list",
      expectedRevision: 3,
    },
  });
  expect(library.conflict).toBe(false);
});

it("keeps the intended operation and visible conflict after a second CAS rejection", async () => {
  state.save.mockRejectedValueOnce({ code: "PORTAL_PREFERENCES_CONFLICT" });
  act(() => library.togglePin("b"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(library.conflict).toBe(true);
  const latest = { ...initial, pinnedIds: ["a", "c"], revision: 2 };
  state.get.mockResolvedValueOnce(latest);
  state.save.mockRejectedValueOnce({ code: "PORTAL_PREFERENCES_CONFLICT" });
  await act(async () => {
    await library.reapplyConflict();
  });
  expect(library.conflict).toBe(true);
  expect(client.getQueryData(["portal-preferences", "alice", "one"])).toEqual(
    latest,
  );
  state.get.mockResolvedValueOnce({ ...latest, layout: "list", revision: 3 });
  state.save.mockImplementationOnce(
    async ({ data }: { data: PortalPreferences }) => ({ ...data, revision: 4 }),
  );
  await act(async () => {
    await library.reapplyConflict();
  });
  expect(state.save).toHaveBeenLastCalledWith({
    data: {
      pinnedIds: ["a", "c", "b"],
      orderedIds: initial.orderedIds,
      layout: "list",
      expectedRevision: 3,
    },
  });
  expect(library.conflict).toBe(false);
});

it("reapplies both in-flight and queued edits after a conflict without losing remote pins", async () => {
  const first = deferred();
  state.save.mockReturnValueOnce(
    first.promise.then(() => {
      throw { code: "PORTAL_PREFERENCES_CONFLICT" };
    }),
  );
  act(() => {
    library.setLayout(AppLibraryLayout.List);
    library.togglePin("b");
  });
  await act(async () => {
    first.resolve();
    await first.promise;
  });
  expect(library.conflict).toBe(true);
  state.get.mockResolvedValueOnce({
    ...initial,
    pinnedIds: ["a", "c"],
    revision: 2,
  });
  state.save.mockImplementationOnce(
    async ({ data }: { data: PortalPreferences }) => ({ ...data, revision: 3 }),
  );
  await act(async () => {
    await library.reapplyConflict();
  });
  expect(state.save).toHaveBeenLastCalledWith({
    data: {
      pinnedIds: ["a", "c", "b"],
      orderedIds: initial.orderedIds,
      layout: "list",
      expectedRevision: 2,
    },
  });
});

it("does not reapply an old account conflict after switching away and back during reload", async () => {
  state.save.mockRejectedValueOnce({ code: "PORTAL_PREFERENCES_CONFLICT" });
  act(() => library.togglePin("b"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(library.conflict).toBe(true);
  let finish!: (value: PortalPreferences) => void;
  state.get.mockReturnValueOnce(
    new Promise<PortalPreferences>((resolve) => {
      finish = resolve;
    }),
  );
  let reapply!: Promise<void>;
  act(() => {
    reapply = library.reapplyConflict();
  });
  state.account = { user: "bob", org: "two" };
  client.setQueryData(["portal-preferences", "bob", "two"], {
    pinnedIds: [],
    orderedIds: [],
    layout: "grid",
  });
  render();
  state.account = { user: "alice", org: "one" };
  render();
  await act(async () => {
    finish({ ...initial, revision: 2 });
    await reapply;
  });
  expect(state.save).toHaveBeenCalledTimes(1);
  expect(library.conflict).toBe(false);
});

it("coalesces rapid layout and pin changes while a save is in flight", async () => {
  const first = deferred();
  state.save.mockReturnValueOnce(first.promise);
  act(() => {
    library.setLayout(AppLibraryLayout.List);
    library.togglePin("b");
  });
  expect(client.getQueryData(["portal-preferences", "alice", "one"])).toEqual({
    ...initial,
    pinnedIds: ["a", "b"],
    layout: "list",
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(library.layout).toBe("list");
  expect(library.pinnedIds.has("b")).toBe(true);
  expect(state.save).toHaveBeenCalledTimes(1);
  await act(async () => {
    first.resolve();
    await first.promise;
  });
  expect(state.save).toHaveBeenCalledTimes(2);
  expect(state.save).toHaveBeenLastCalledWith({
    data: {
      ...initial,
      pinnedIds: ["a", "b"],
      layout: "list",
      expectedRevision: 1,
    },
  });
});

it("keeps local edits when an older preferences read finishes late", async () => {
  let finish!: (value: PortalPreferences) => void;
  const stale = new Promise<PortalPreferences>((resolve) => {
    finish = resolve;
  });
  state.get.mockReturnValueOnce(stale);
  const read = client.refetchQueries({
    queryKey: ["portal-preferences", "alice", "one"],
  });
  act(() => library.togglePin("b"));
  await act(async () => {
    finish(initial);
    await read;
  });
  expect(
    client.getQueryData<PortalPreferences>([
      "portal-preferences",
      "alice",
      "one",
    ])?.pinnedIds,
  ).toEqual(["a", "b"]);
});

it("does not leave an unsent queued edit cached when returning to an account", async () => {
  const first = deferred();
  state.save.mockReturnValueOnce(first.promise);
  act(() => {
    library.setLayout(AppLibraryLayout.List);
    library.togglePin("b");
  });
  state.account = { user: "bob", org: "two" };
  client.setQueryData(["portal-preferences", "bob", "two"], {
    pinnedIds: [],
    orderedIds: [],
    layout: "grid",
  });
  render();
  state.account = { user: "alice", org: "one" };
  render();
  expect(
    client.getQueryData<PortalPreferences>([
      "portal-preferences",
      "alice",
      "one",
    ])?.pinnedIds,
  ).toEqual(["a"]);
  await act(async () => {
    first.resolve();
    await first.promise;
  });
});

it("does not send queued old-account edits or mutate a new account after switching", async () => {
  const first = deferred();
  state.save.mockReturnValueOnce(first.promise);
  act(() => {
    library.setLayout(AppLibraryLayout.List);
    library.togglePin("b");
  });
  const newAccount: PortalPreferences = {
    pinnedIds: [],
    orderedIds: [],
    layout: "grid",
  };
  client.setQueryData(["portal-preferences", "bob", "two"], newAccount);
  state.account = { user: "bob", org: "two" };
  render();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  act(() => library.togglePin("c"));
  expect(state.save).toHaveBeenCalledTimes(2);
  await act(async () => {
    first.resolve();
    await first.promise;
  });
  expect(state.save).toHaveBeenCalledTimes(2);
  expect(client.getQueryData(["portal-preferences", "bob", "two"])).toEqual({
    ...newAccount,
    pinnedIds: ["c"],
    revision: 1,
  });
});
