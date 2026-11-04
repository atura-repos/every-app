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
  AppListItem: ({ app }: any) => <li>{app.name}</li>,
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
