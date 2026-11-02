// @vitest-environment happy-dom
import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  options: vi.fn(),
  access: vi.fn(),
  refetch: vi.fn(),
  invalidate: vi.fn(),
  links: [] as {
    id: string;
    organizationId: string;
    name: string;
    url: string;
    everyone: boolean;
    createdAt: Date;
    updatedAt: Date;
  }[],
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@/serverFunctions/externalLinks", () => ({
  createExternalLink: mocks.create,
  updateExternalLink: mocks.update,
  deleteExternalLink: mocks.remove,
  externalLinkAccessOptions: mocks.options,
  getExternalLinkAccess: mocks.access,
}));
vi.mock("@/client/hooks/useSession", () => ({
  useSession: () => ({ data: { session: { activeOrganizationId: "org-a" } } }),
}));
vi.mock("@/client/hooks/useExternalLinks", () => ({
  useExternalLinks: () => ({
    data: mocks.links,
    isPending: false,
    isError: false,
    refetch: mocks.refetch,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { Route } from "./external-links";
const Page = (Route as unknown as { options: { component: ComponentType } })
  .options.component;
let root: Root, container: HTMLDivElement;
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.options.mockResolvedValue({
    people: [{ id: "user-a", name: "Ana", email: "ana@example.org" }],
    groups: [{ id: "grp_a", name: "Risk team" }],
  });
  mocks.access.mockResolvedValue({ everyone: true, userIds: [], groupIds: [] });
  mocks.links = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function mount() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <Page />
      </QueryClientProvider>,
    ),
  );
}
async function submit(name: string, url: string) {
  const inputs = container.querySelectorAll("input");
  await act(async () => {
    for (const [input, value] of [
      [inputs[0], name],
      [inputs[1], url],
    ] as const) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
describe("admin external links", () => {
  it("sends selected member and group grants for a restricted link", async () => {
    await mount();
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((b) => b.textContent === "Selected members and groups")!
        .click();
    });
    const choices = Array.from(
      container.querySelectorAll('input[type="checkbox"]'),
    ) as HTMLInputElement[];
    await act(async () => {
      choices[0]!.click();
      choices[1]!.click();
    });
    await submit("Risk", "https://example.org/");
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        name: "Risk",
        url: "https://example.org/",
        access: { everyone: false, userIds: ["user-a"], groupIds: ["grp_a"] },
      },
    });
  });
  it("loads saved grants when editing a restricted link", async () => {
    const id = "b500803e-444f-4000-8000-000000000000";
    mocks.links = [
      {
        id,
        organizationId: "org-a",
        name: "Risk",
        url: "https://example.org/",
        everyone: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    mocks.access.mockResolvedValue({
      everyone: false,
      userIds: ["user-a"],
      groupIds: ["grp_a"],
    });
    await mount();
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((b) => b.textContent === "Edit")!
        .click();
    });
    expect(mocks.access).toHaveBeenCalledWith({ data: { id } });
    expect(
      (
        Array.from(
          container.querySelectorAll('input[type="checkbox"]'),
        ) as HTMLInputElement[]
      ).map((input) => input.checked),
    ).toEqual([true, true]);
  });
  it("creates a navigation link without app registration", async () => {
    await mount();
    await submit("Risk", "https://example.org/");
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        name: "Risk",
        url: "https://example.org/",
        access: { everyone: true, userIds: [], groupIds: [] },
      },
    });
  });
  it("edits and deletes an existing link", async () => {
    const id = "b500803e-444f-4000-8000-000000000000";
    mocks.links = [
      {
        id,
        organizationId: "org-a",
        name: "Risk",
        url: "https://example.org/",
        everyone: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    await mount();
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Edit")!
        .click();
    });
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(mocks.update).toHaveBeenCalledWith({
      data: {
        id,
        name: "Risk",
        url: "https://example.org/",
        access: { everyone: true, userIds: [], groupIds: [] },
      },
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Delete")!
        .click();
    });
    expect(mocks.remove).toHaveBeenCalledWith({ data: { id } });
  });
});
