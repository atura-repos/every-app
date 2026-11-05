// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WorkspaceLayoutSettings } from "./WorkspaceLayoutSettings";
import { AppLibraryLayout } from "@/client/hooks/useAppLibrary";
import type { PortalPreferences } from "@/server/repositories/PersonalPortalRepository";

vi.mock("@/client/hooks/useAppLibrary", () => ({
  AppLibraryLayout: { Grid: "grid", List: "list" },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it("edits layout and collections in personal settings while preserving pins and assignments", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  let preferences: PortalPreferences = {
    layout: "grid",
    pinnedIds: ["personal:note"],
    orderedIds: [],
    collections: [{ id: "work", name: "Work" }],
    assignments: { "personal:note": "work" },
    revision: 4,
  };
  const render = () =>
    root.render(
      <WorkspaceLayoutSettings
        preferences={preferences}
        layout={preferences.layout as AppLibraryLayout}
        onUpdate={(change) => {
          preferences = change(preferences);
          render();
        }}
      />,
    );
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find(
      (element) => element.textContent?.trim() === label,
    )!;
  act(render);
  act(() => button("List view").click());
  expect(preferences).toMatchObject({
    layout: "list",
    pinnedIds: ["personal:note"],
    revision: 4,
  });
  expect(button("List view").getAttribute("aria-pressed")).toBe("true");
  const input = container.querySelector("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "Projects");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(preferences.collections?.map((collection) => collection.name)).toEqual(
    ["Work", "Projects"],
  );
  const prompt = vi.spyOn(window, "prompt").mockReturnValue("Renamed");
  act(() =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Rename Work"]')!
      .click(),
  );
  expect(preferences.collections?.[0].name).toBe("Renamed");
  prompt.mockRestore();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  act(() =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Delete Renamed"]')!
      .click(),
  );
  expect(preferences.collections?.map((collection) => collection.name)).toEqual(
    ["Projects"],
  );
  expect(preferences.pinnedIds).toEqual(["personal:note"]);
  expect(preferences.assignments?.["personal:note"]).toBeUndefined();
  act(() => button("Reset layout").click());
  expect(preferences.collections).toEqual([]);
  confirm.mockRestore();
  act(() => root.unmount());
});
