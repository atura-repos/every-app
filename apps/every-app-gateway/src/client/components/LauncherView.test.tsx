// @vitest-environment happy-dom
import { createRoot } from "react-dom/client";
import { act } from "react";
import { expect, it, vi } from "vitest";
import { LauncherView } from "./LauncherView";
vi.mock("@/client/hooks/useAppLibrary", () => ({
  AppLibraryLayout: { Grid: "grid", List: "list" },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: any) => <a href={props.to}>{children}</a>,
}));
vi.mock("./AppListItem", () => ({
  AppListItem: ({ app }: any) => <div>{app.name}</div>,
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
it("takes a member directly to the personal link form", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() =>
    root.render(
      <LauncherView
        {...({
          apps: [],
          preferences: { pinnedIds: [], orderedIds: [], layout: "grid" },
          layout: "grid",
          onUpdate: vi.fn(),
          onOpenSetup: vi.fn(),
          onUseMcp: vi.fn(),
        } as any)}
      />,
    ),
  );
  const add = [...container.querySelectorAll("a")].find((a) =>
    a.textContent?.includes("Add my own link"),
  );
  expect(add?.getAttribute("href")).toBe("/settings#add-personal-link");
  const settings = [...container.querySelectorAll("a")].find((a) =>
    a.textContent?.includes("Manage layout and collections"),
  );
  expect(settings?.getAttribute("href")).toBe("/settings#home-layout");
  act(() => root.unmount());
});
it("shows a single combined result count and never matches a private URL", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const props = {
    apps: [{ id: "a", name: "Editor", description: "Workspace", kind: "web" }],
    externalLinks: [
      {
        id: "b",
        name: "Atura docs",
        url: "https://example.org/private?secret=canary",
      },
    ],
    personalLinks: [{ id: "c", name: "My notes", url: "https://example.org/" }],
    preferences: { pinnedIds: [], orderedIds: [], layout: "grid" as const },
    layout: "grid" as const,
    onUpdate: vi.fn(),
    onOpenSetup: vi.fn(),
    onUseMcp: vi.fn(),
  };
  act(() => root.render(<LauncherView {...(props as any)} />));
  expect(container.textContent).toContain("3 items");
  expect(container.textContent).not.toContain("Add collection");
  expect(container.textContent).not.toContain("Reset layout");
  expect(
    container.querySelector('[role="group"][aria-label="App layout"]'),
  ).toBeNull();
  expect(container.querySelector("li li")).toBeNull();
  const search = container.querySelector('input[type="search"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(search, "canary");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.textContent).toContain("0 results");
  act(() => root.unmount());
});

it("clears query independently of type filter and vice versa", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() =>
    root.render(
      <LauncherView
        {...({
          apps: [{ id: "a", name: "Editor", description: "Workspace" }],
          personalLinks: [
            { id: "b", name: "Notes", url: "https://example.org/" },
          ],
          preferences: { pinnedIds: [], orderedIds: [], layout: "grid" },
          layout: "grid",
          onUpdate: vi.fn(),
          onOpenSetup: vi.fn(),
          onUseMcp: vi.fn(),
        } as any)}
      />,
    ),
  );
  const button = (text: string) =>
    [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === text,
    )!;
  const search = container.querySelector('input[type="search"]')!;
  const enter = (text: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(search, text);
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
  act(() => button("Own links").click());
  enter("Editor");
  expect(container.textContent).toContain("0 results");
  act(() => button("Clear search").click());
  expect(container.textContent).toContain("1 results");
  expect(button("Own links").getAttribute("aria-pressed")).toBe("true");
  enter("Editor");
  act(() => button("Clear filters").click());
  expect(container.textContent).toContain("1 results");
  expect((search as HTMLInputElement).value).toBe("Editor");
  expect(button("All").getAttribute("aria-pressed")).toBe("true");
  act(() => root.unmount());
});

it("announces confirmed save, conflict and failure without a permanent requested state", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const props = {
    apps: [],
    personalLinks: [{ id: "a", name: "Notes", url: "https://example.org/" }],
    preferences: { pinnedIds: [], orderedIds: [], layout: "grid" },
    layout: "grid",
    onUpdate: vi.fn(),
    onOpenSetup: vi.fn(),
    onUseMcp: vi.fn(),
  };
  const show = (saveStatus: string) =>
    act(() =>
      root.render(<LauncherView {...({ ...props, saveStatus } as any)} />),
    );
  show("");
  const pin = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Pin Notes"),
  )!;
  act(() => pin.click());
  expect(container.querySelector('[role="status"]')?.textContent).not.toContain(
    "requested",
  );
  for (const [value, message] of [
    ["saving", "Saving layout"],
    ["saved", "Layout saved"],
    ["conflict", "Layout changed"],
    ["error", "Could not save"],
  ]) {
    show(value);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      message,
    );
  }
  show("");
  expect(container.querySelector('[role="status"]')?.textContent).not.toContain(
    "Saving layout",
  );
  act(() => root.unmount());
});

it("renders the saved layout without duplicating its settings on the home page", () => {
  const container = document.createElement("div");
  let root = createRoot(container);
  let saved = {
    pinnedIds: ["a"],
    orderedIds: ["a"],
    layout: "list" as "grid" | "list",
    revision: 3,
  };
  const props = {
    apps: [{ id: "a", name: "Editor", description: "Workspace" }],
    onUpdate: (change: (current: typeof saved) => typeof saved) => {
      saved = change(saved);
      root.render(
        <LauncherView
          {...({ ...props, preferences: saved, layout: saved.layout } as any)}
        />,
      );
    },
    onOpenSetup: vi.fn(),
    onUseMcp: vi.fn(),
  };
  act(() =>
    root.render(
      <LauncherView
        {...({ ...props, preferences: saved, layout: saved.layout } as any)}
      />,
    ),
  );
  const button = (name: string) =>
    [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === name,
    )!;
  expect(button("List view")).toBeUndefined();
  expect(
    container.querySelector('section[aria-label="Pinned"] ul')?.className,
  ).not.toContain("md:grid-cols-2");
  act(() => root.unmount());
  root = createRoot(container);
  act(() =>
    root.render(
      <LauncherView
        {...({ ...props, preferences: saved, layout: saved.layout } as any)}
      />,
    ),
  );
  expect(button("Grid view")).toBeUndefined();
  expect(saved.layout).toBe("list");
  act(() => root.unmount());
});

it("focuses launcher search with Cmd/Ctrl+K and releases the shortcut on unmount", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <LauncherView
        {...({
          apps: [],
          preferences: { pinnedIds: [], orderedIds: [], layout: "grid" },
          layout: "grid",
          onUpdate: vi.fn(),
          onOpenSetup: vi.fn(),
          onUseMcp: vi.fn(),
        } as any)}
      />,
    ),
  );
  const search = container.querySelector('input[type="search"]')!;
  for (const modifier of ["metaKey", "ctrlKey"] as const) {
    const event = new KeyboardEvent("keydown", {
      key: "k",
      [modifier]: true,
      cancelable: true,
      bubbles: true,
    });
    act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(search);
  }
  act(() => root.unmount());
  const event = new KeyboardEvent("keydown", {
    key: "k",
    ctrlKey: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  container.remove();
});

it("keeps pin state when moving to Other by pointer and ignores canceled gestures", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let preferences = {
    pinnedIds: ["personal:1"],
    orderedIds: [] as string[],
    layout: "grid" as const,
    collections: [{ id: "work", name: "Work" }],
    assignments: { "personal:1": "work" } as Record<string, string>,
  };
  const update = vi.fn(
    (change: (value: typeof preferences) => typeof preferences) => {
      preferences = change(preferences);
      root.render(
        <LauncherView {...(props as any)} preferences={preferences} />,
      );
    },
  );
  const props = {
    apps: [],
    personalLinks: [{ id: "1", name: "Notes", url: "https://example.org/" }],
    layout: "grid" as const,
    onUpdate: update,
    onOpenSetup: vi.fn(),
    onUseMcp: vi.fn(),
  };
  act(() =>
    root.render(<LauncherView {...(props as any)} preferences={preferences} />),
  );
  const handle = container.querySelector<HTMLButtonElement>(
    '[aria-label="Drag Notes to a collection"]',
  )!;
  const hit = vi
    .spyOn(document, "elementFromPoint")
    .mockReturnValue(container.querySelector('section[aria-label="Other"]')!);
  const pointer = (type: string, x: number, y: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      pointerId: 3,
      pointerType: "touch",
      clientX: x,
      clientY: y,
      button: 0,
    });
    act(() => handle.dispatchEvent(event));
  };
  pointer("pointerdown", 1, 1);
  pointer("pointermove", 30, 30);
  pointer("pointercancel", 30, 30);
  pointer("pointerup", 30, 30);
  expect(update).not.toHaveBeenCalled();
  pointer("pointerdown", 1, 1);
  pointer("pointermove", 30, 30);
  pointer("pointerup", 30, 30);
  expect(preferences.assignments).toEqual({});
  expect(preferences.pinnedIds).toEqual(["personal:1"]);
  expect(
    container.querySelector('section[aria-label="Pinned"]')?.textContent,
  ).toContain("Notes");
  expect(
    container.querySelector('section[aria-label="Other"]')?.textContent,
  ).not.toContain("Notes");
  hit.mockRestore();
  act(() => root.unmount());
  container.remove();
});

it("moves a typed shortcut across collections by touch pointer without opening its link", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let preferences = {
    pinnedIds: [] as string[],
    orderedIds: [] as string[],
    layout: "grid" as const,
    collections: [
      { id: "work", name: "Work" },
      { id: "home", name: "Home" },
    ],
    assignments: { "personal:1": "work" } as Record<string, string>,
    revision: 7,
  };
  const props = {
    apps: [],
    personalLinks: [{ id: "1", name: "Notes", url: "https://example.org/" }],
    layout: "grid" as const,
    onUpdate: (change: (value: typeof preferences) => typeof preferences) => {
      preferences = change(preferences);
      root.render(
        <LauncherView {...(props as any)} preferences={preferences} />,
      );
    },
    onOpenSetup: vi.fn(),
    onUseMcp: vi.fn(),
  };
  act(() =>
    root.render(<LauncherView {...(props as any)} preferences={preferences} />),
  );
  const handle = container.querySelector<HTMLButtonElement>(
    '[aria-label="Drag Notes to a collection"]',
  )!;
  expect(handle).not.toBeNull();
  const destination = container.querySelector<HTMLElement>(
    'section[aria-label="Home"]',
  )!;
  const hit = vi
    .spyOn(document, "elementFromPoint")
    .mockReturnValue(destination);
  const pointer = (type: string, x: number, y: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      pointerId: 3,
      pointerType: "touch",
      clientX: x,
      clientY: y,
      button: 0,
    });
    act(() => handle.dispatchEvent(event));
  };
  pointer("pointerdown", 1, 1);
  pointer("pointermove", 25, 25);
  pointer("pointerup", 25, 25);
  expect(preferences.assignments).toEqual({ "personal:1": "home" });
  expect(preferences.revision).toBe(7);
  expect(
    container.querySelector('section[aria-label="Home"]')?.textContent,
  ).toContain("Notes");
  expect(
    container.querySelector('section[aria-label="Work"]')?.textContent,
  ).not.toContain("Notes");
  expect(
    container.querySelector('a[href="https://example.org/"]'),
  ).not.toBeNull();
  hit.mockRestore();
  act(() => root.unmount());
  container.remove();
});

it("moves to an offscreen collection by a tap on a narrow touch viewport", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let preferences = {
    pinnedIds: [] as string[],
    orderedIds: [] as string[],
    layout: "grid" as const,
    collections: [
      { id: "near", name: "Near" },
      { id: "far", name: "Far" },
    ],
    assignments: { "personal:1": "near" } as Record<string, string>,
  };
  const update = vi.fn(
    (change: (p: typeof preferences) => typeof preferences) => {
      preferences = change(preferences);
      root.render(
        <LauncherView {...(props as any)} preferences={preferences} />,
      );
    },
  );
  const props = {
    apps: [],
    personalLinks: [{ id: "1", name: "Notes", url: "https://example.org" }],
    layout: "grid",
    onUpdate: update,
    onOpenSetup: vi.fn(),
    onUseMcp: vi.fn(),
  };
  act(() =>
    root.render(<LauncherView {...(props as any)} preferences={preferences} />),
  );
  const far = container.querySelector<HTMLElement>(
    'section[aria-label="Far"]',
  )!;
  Object.defineProperty(far, "getBoundingClientRect", {
    value: () => ({ top: 900, bottom: 1100, left: 0, right: 320 }),
  });
  expect(far.getBoundingClientRect().top).toBeGreaterThan(480);
  const select = container.querySelector(
    '[aria-label="Collection for Notes"]',
  ) as unknown as HTMLSelectElement;
  expect(select.closest("label")?.textContent).toMatch(/Tap.*move/i);
  act(() => {
    select.value = "far";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(update).toHaveBeenCalledTimes(1);
  expect(preferences.assignments).toEqual({ "personal:1": "far" });
  act(() => root.unmount());
  container.remove();
});

it("disables dragging in search results and tells users to clear search or use the menu", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const update = vi.fn();
  act(() =>
    root.render(
      <LauncherView
        {...({
          apps: [],
          personalLinks: [
            { id: "1", name: "Notes", url: "https://example.org" },
          ],
          preferences: {
            pinnedIds: [],
            orderedIds: [],
            layout: "grid",
            collections: [{ id: "far", name: "Far" }],
          },
          layout: "grid",
          onUpdate: update,
          onOpenSetup: vi.fn(),
          onUseMcp: vi.fn(),
        } as any)}
      />,
    ),
  );
  const search = container.querySelector('input[type="search"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(search, "Notes");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(
    container.querySelector('section[aria-label="Results"]'),
  ).not.toBeNull();
  const handle = container.querySelector<HTMLButtonElement>(
    '[aria-label="Drag Notes to a collection"]',
  )!;
  expect(handle.disabled).toBe(true);
  expect(container.textContent).toMatch(/clear search.*drag.*collection menu/i);
  const down = new Event("pointerdown", { bubbles: true });
  Object.assign(down, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
  act(() => handle.dispatchEvent(down));
  expect(update).not.toHaveBeenCalled();
  const select = container.querySelector(
    '[aria-label="Collection for Notes"]',
  ) as unknown as HTMLSelectElement;
  act(() => {
    select.value = "far";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(update).toHaveBeenCalledTimes(1);
  expect(
    update.mock.calls[0]?.[0]({
      assignments: {},
      collections: [{ id: "far", name: "Far" }],
    }),
  ).toEqual({
    assignments: { "personal:1": "far" },
    collections: [{ id: "far", name: "Far" }],
  });
  const clear = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Clear search",
  )!;
  act(() => clear.click());
  const own = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Own links",
  )!;
  act(() => own.click());
  expect(handle.disabled).toBe(true);
  act(() => root.unmount());
});

it("does not revive an unconfirmed move announcement after conflict and latest-layout reload", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const original = {
    pinnedIds: [],
    orderedIds: [],
    layout: "grid",
    collections: [
      { id: "work", name: "Work" },
      { id: "home", name: "Home" },
    ],
    assignments: { "personal:1": "work" },
    revision: 4,
  };
  const props = {
    apps: [],
    personalLinks: [{ id: "1", name: "Notes", url: "https://example.org" }],
    layout: "grid",
    onUpdate: vi.fn(),
    onOpenSetup: vi.fn(),
    onUseMcp: vi.fn(),
  };
  const show = (
    preferences: typeof original,
    saveStatus: "" | "saving" | "conflict",
  ) =>
    act(() =>
      root.render(
        <LauncherView
          {...(props as any)}
          preferences={preferences}
          saveStatus={saveStatus}
        />,
      ),
    );
  show(original, "");
  const handle = container.querySelector<HTMLButtonElement>(
    '[aria-label="Drag Notes to a collection"]',
  )!;
  const hit = vi
    .spyOn(document, "elementFromPoint")
    .mockReturnValue(container.querySelector('section[aria-label="Home"]')!);
  for (const [type, x] of [
    ["pointerdown", 1],
    ["pointermove", 30],
    ["pointerup", 30],
  ] as const) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: x,
      clientY: x,
    });
    act(() => handle.dispatchEvent(event));
  }
  expect(container.textContent).toContain("Notes moved to Home");
  show(original, "conflict");
  expect(container.textContent).not.toContain("Notes moved to Home");
  show({ ...original, assignments: { "personal:1": "work" }, revision: 5 }, "");
  expect(container.textContent).not.toContain("Notes moved to Home");
  hit.mockRestore();
  act(() => root.unmount());
  container.remove();
});
