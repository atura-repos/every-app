// @vitest-environment happy-dom
import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  options: vi.fn(),
  access: vi.fn(),
  refetch: vi.fn(),
  invalidate: vi.fn(),
  session: {
    userId: "user-a",
    orgId: "org-a",
    validated: true,
    fetching: false,
    error: null as Error | null,
  },
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
  useSession: () => ({
    data: {
      user: { id: mocks.session.userId },
      session: { activeOrganizationId: mocks.session.orgId },
    },
    isFetchedAfterMount: mocks.session.validated,
    isFetching: mocks.session.fetching,
    error: mocks.session.error,
  }),
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
let root: Root, container: HTMLDivElement, client: QueryClient;
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
  Object.assign(mocks.session, {
    userId: "user-a",
    orgId: "org-a",
    validated: true,
    fetching: false,
    error: null,
  });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: "always" } },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});
async function mount() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>,
    ),
  );
}
async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
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
  it.each([
    ["workspace", "orgId", "org-b"],
    ["user in the same workspace", "userId", "user-b"],
  ] as const)(
    "resets the entire draft when switching %s",
    async (_label, field, value) => {
      await mount();
      await changeInput(
        container.querySelectorAll("input")[0]!,
        "Secret draft",
      );
      await changeInput(
        container.querySelectorAll("input")[1]!,
        "https://private.example/path",
      );
      await act(async () => {
        Array.from(container.querySelectorAll("button"))
          .find(
            (button) => button.textContent === "Selected members and groups",
          )!
          .click();
      });
      await act(async () => {
        (
          container.querySelector('input[type="checkbox"]') as HTMLInputElement
        ).click();
      });
      mocks.session[field] = value;
      await mount();
      expect(
        (container.querySelectorAll("input")[0] as HTMLInputElement).value,
      ).toBe("");
      expect(
        (container.querySelectorAll("input")[1] as HTMLInputElement).value,
      ).toBe("");
      expect(container.textContent).toContain(
        "Choose an audience before publishing",
      );
      expect(container.querySelector('input[type="checkbox"]')).toBeNull();
      await submit("Fresh", "https://example.org/");
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it("ignores an access response from the previous identity and keeps the new draft", async () => {
    const id = "b500803e-444f-4000-8000-000000000000";
    mocks.links = [
      {
        id,
        organizationId: "org-a",
        name: "Old link",
        url: "https://old.example/",
        everyone: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    let resolveAccess!: (value: {
      everyone: boolean;
      userIds: string[];
      groupIds: string[];
    }) => void;
    mocks.access.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAccess = resolve;
        }),
    );
    await mount();
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Edit")!
        .click();
    });
    mocks.session.orgId = "org-b";
    mocks.links = [];
    await mount();
    await changeInput(container.querySelectorAll("input")[0]!, "New draft");
    await act(async () =>
      resolveAccess({
        everyone: false,
        userIds: ["user-a"],
        groupIds: ["grp_a"],
      }),
    );
    expect(
      (container.querySelectorAll("input")[0] as HTMLInputElement).value,
    ).toBe("New draft");
    expect(container.querySelector("form")?.getAttribute("aria-label")).toBe(
      "Add external link",
    );
    expect(container.textContent).toContain(
      "Choose an audience before publishing",
    );
  });
  it("drops a draft while the session is being revalidated", async () => {
    await mount();
    await changeInput(
      container.querySelectorAll("input")[0]!,
      "Prior user draft",
    );
    mocks.session.fetching = true;
    await mount();
    expect(container.textContent).not.toContain("Prior user draft");
    mocks.session.userId = "user-b";
    mocks.session.fetching = false;
    await mount();
    expect(
      (container.querySelectorAll("input")[0] as HTMLInputElement).value,
    ).toBe("");
  });
  it("never persists member names and emails in the query snapshot", async () => {
    await mount();
    const snapshot = dehydrate(client, {
      shouldDehydrateQuery: (query) =>
        query.state.status === "success" && query.meta?.persist !== false,
    });
    expect(mocks.options).toHaveBeenCalled();
    expect(JSON.stringify(snapshot)).not.toContain("ana@example.org");
    expect(JSON.stringify(snapshot)).not.toContain("Risk team");
  });
  it("hides restored options on an offline reload until live validation", async () => {
    client.setQueryData(["external-link-access-options", "org-a", "user-a"], {
      people: [
        { id: "old", name: "Former admin", email: "former@example.org" },
      ],
      groups: [{ id: "old-group", name: "Confidential group" }],
    });
    mocks.session.validated = false;
    mocks.options.mockRejectedValue(new Error("offline"));
    await mount();
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("former@example.org");
    expect(mocks.options).not.toHaveBeenCalled();

    mocks.session.validated = true;
    await mount();
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Selected members and groups")!
        .click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.options).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Could not load access choices");
    expect(container.textContent).not.toContain("former@example.org");
    expect(container.textContent).not.toContain("Confidential group");
    expect(
      container
        .querySelector('button[type="submit"]')
        ?.hasAttribute("disabled"),
    ).toBe(true);
  });
  it("hides previous account options during a same-org account switch", async () => {
    await mount();
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Selected members and groups")!
        .click();
    });
    expect(container.textContent).toContain("ana@example.org");
    mocks.session.fetching = true;
    await mount();
    expect(container.textContent).not.toContain("ana@example.org");
    mocks.session.userId = "user-b";
    mocks.session.fetching = false;
    let resolveOptions!: (value: {
      people: { id: string; name: string; email: string }[];
      groups: { id: string; name: string }[];
    }) => void;
    mocks.options.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOptions = resolve;
        }),
    );
    await mount();
    expect(container.textContent).not.toContain("ana@example.org");
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Selected members and groups")!
        .click();
    });
    expect(
      container
        .querySelector('button[type="submit"]')
        ?.hasAttribute("disabled"),
    ).toBe(true);
    await act(async () =>
      resolveOptions({
        people: [{ id: "user-b", name: "Bob", email: "bob@example.org" }],
        groups: [],
      }),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("bob@example.org");
    expect(container.textContent).not.toContain("ana@example.org");
  });
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
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((b) => b.textContent === "Everyone")!
        .click(),
    );
    await submit("Risk", "https://example.org/");
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        name: "Risk",
        url: "https://example.org/",
        access: { everyone: true, userIds: [], groupIds: [] },
      },
    });
  });
  it("requires explicit audience and hostname re-entry", async () => {
    await mount();
    await submit("Risk", "https://example.org/");
    expect(mocks.create).not.toHaveBeenCalled();
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((b) => b.textContent === "Everyone")!
        .click(),
    );
    await submit("Risk", "https://example.org/");
    expect(mocks.create).toHaveBeenCalledOnce();
    mocks.links = [
      {
        id: "b500803e-444f-4000-8000-000000000000",
        organizationId: "org-a",
        name: "Risk",
        url: "https://example.org/",
        everyone: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    await mount();
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((b) => b.textContent === "Edit")!
        .click(),
    );
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(mocks.update).not.toHaveBeenCalled();
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
      const input = Array.from(container.querySelectorAll("input")).find(
        (i) => i.autocomplete === "off",
      )!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "example.org");
      input.dispatchEvent(new Event("input", { bubbles: true }));
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
        confirmedHostname: "example.org",
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
