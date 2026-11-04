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
