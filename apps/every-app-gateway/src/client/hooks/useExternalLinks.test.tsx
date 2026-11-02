// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
  hydrate,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useExternalLinks } from "./useExternalLinks";

const { session, listExternalLinks } = vi.hoisted(() => ({
  session: {
    userId: "alice",
    orgId: "org-1",
    validated: true,
    fetching: false,
    error: null as Error | null,
  },
  listExternalLinks: vi.fn(),
}));
vi.mock("@/client/hooks/useSession", () => ({
  useSession: () => ({
    data: {
      user: { id: session.userId },
      session: { activeOrganizationId: session.orgId },
    },
    isFetchedAfterMount: session.validated,
    isFetching: session.fetching,
    error: session.error,
  }),
}));
vi.mock("@/serverFunctions/externalLinks", () => ({ listExternalLinks }));

const restricted = [
  { id: "secret", name: "Private portal", url: "https://private.example" },
];
const publicLink = {
  id: "public",
  name: "Public",
  url: "https://public.example",
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let client: QueryClient;
let container: HTMLElement;
let root: Root;

function Links() {
  const { data, isError } = useExternalLinks();
  return (
    <output>
      {data?.map((link) => link.name).join(", ") ??
        (isError ? "unavailable" : "loading")}
    </output>
  );
}

function mount() {
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <Links />
      </QueryClientProvider>,
    ),
  );
}

async function expectText(text: string) {
  for (
    let attempt = 0;
    attempt < 20 && container.textContent !== text;
    attempt++
  ) {
    await act(async () => {
      await tick();
    });
  }
  expect(container.textContent).toBe(text);
}

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  session.userId = "alice";
  session.orgId = "org-1";
  session.validated = true;
  session.fetching = false;
  session.error = null;
  listExternalLinks.mockReset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: "always" } },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  container.remove();
});

it("does not restore a restricted link after revoke and offline reload", async () => {
  listExternalLinks.mockResolvedValueOnce(restricted);
  mount();
  await expectText("Private portal");

  // Root's persistence rule: successful queries except meta.persist === false.
  const snapshot = dehydrate(client, {
    shouldDehydrateQuery: (query) =>
      query.state.status === "success" && query.meta?.persist !== false,
  });
  expect(JSON.stringify(snapshot)).not.toContain("private.example");
  expect(JSON.stringify(snapshot)).not.toContain("Private portal");

  act(() => root.unmount());
  container.remove();
  client.clear();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: "always" } },
  });
  hydrate(client, snapshot);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  listExternalLinks.mockRejectedValueOnce(new Error("offline"));
  mount();
  await expectText("unavailable");
  expect(container.textContent).not.toContain("Private portal");
});

it("does not show another user's cached links while switching users or revalidating", async () => {
  listExternalLinks.mockResolvedValueOnce(restricted);
  mount();
  await expectText("Private portal");

  session.userId = "bob";
  session.validated = false;
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <Links />
      </QueryClientProvider>,
    ),
  );
  expect(container.textContent).not.toContain("Private portal");
  session.validated = true;
  listExternalLinks.mockResolvedValueOnce([publicLink]);
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <Links />
      </QueryClientProvider>,
    ),
  );
  await expectText("Public");
});

it("hides links while a cached session is being revalidated for a user switch", async () => {
  listExternalLinks
    .mockResolvedValueOnce(restricted)
    .mockResolvedValueOnce([publicLink]);
  mount();
  await expectText("Private portal");
  session.fetching = true;
  mount();
  expect(container.textContent).toBe("loading");
  session.userId = "bob";
  session.fetching = false;
  mount();
  await expectText("Public");
});

it("does not reveal an old persisted restricted link when session validation fails", async () => {
  const previous = new QueryClient();
  previous.setQueryData(["external-links", "org-1"], restricted);
  hydrate(client, dehydrate(previous));
  previous.clear();
  session.validated = false;
  session.error = new Error("offline");
  mount();
  await act(async () => {
    await tick();
  });
  expect(container.textContent).not.toContain("Private portal");
  expect(listExternalLinks).not.toHaveBeenCalled();
});

it("keeps permitted links after a successful access revocation refresh", async () => {
  listExternalLinks
    .mockResolvedValueOnce([restricted[0], publicLink])
    .mockResolvedValueOnce([publicLink]);
  mount();
  await expectText("Private portal, Public");
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["external-links"] });
    await tick();
  });
  await expectText("Public");
});

it("hides a formerly visible link when its revalidation fails", async () => {
  listExternalLinks.mockResolvedValueOnce(restricted);
  mount();
  await expectText("Private portal");
  listExternalLinks.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["external-links"] });
    await tick();
  });
  expect(container.textContent).toBe("unavailable");
});
