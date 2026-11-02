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
  }),
}));
vi.mock("@/client/tanstack-db", () => ({
  userAppsCollection: { utils: { refetch: vi.fn() } },
  useQueryFailed: () => false,
  useQueryPending: () => false,
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
  await act(async () => {
    await Promise.resolve();
  });
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  container.remove();
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
    data: { pinnedIds: ["b"], orderedIds: ["b", "a", "c"], layout: "grid" },
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
  render();
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
    data: { ...initial, pinnedIds: ["a", "b"], layout: "list" },
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
    await Promise.resolve();
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
  });
});
