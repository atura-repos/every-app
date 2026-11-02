// @vitest-environment happy-dom
import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  refetch: vi.fn(),
  invalidate: vi.fn(),
  links: [] as {
    id: string;
    organizationId: string;
    name: string;
    url: string;
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
  it("creates a navigation link without app registration", async () => {
    await mount();
    await submit("Risk", "https://example.org/");
    expect(mocks.create).toHaveBeenCalledWith({
      data: { name: "Risk", url: "https://example.org/" },
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
      data: { id, name: "Risk", url: "https://example.org/" },
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
