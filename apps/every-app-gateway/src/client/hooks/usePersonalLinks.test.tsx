// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
  hydrate,
} from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { usePersonalLinks } from "./usePersonalLinks";

const state = vi.hoisted(() => ({
  user: "alice",
  org: "one",
  validated: true,
  fetching: false,
  error: null as Error | null,
  list: vi.fn(),
}));
vi.mock("./useSession", () => ({
  useSession: () => ({
    data: {
      user: { id: state.user },
      session: { activeOrganizationId: state.org },
    },
    isFetchedAfterMount: state.validated,
    isFetching: state.fetching,
    error: state.error,
  }),
}));
vi.mock("@/serverFunctions/personalPortal", () => ({
  listPersonalLinks: state.list,
}));

let client: QueryClient;
let root: Root;
let element: HTMLElement;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function View() {
  const { data, isError } = usePersonalLinks();
  return (
    <output>
      {data?.map((link) => link.name).join(", ") ??
        (isError ? "unavailable" : "loading")}
    </output>
  );
}
function render() {
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <View />
      </QueryClientProvider>,
    ),
  );
}
async function expectText(value: string) {
  for (let i = 0; i < 20 && element.textContent !== value; i++) await act(tick);
  expect(element.textContent).toBe(value);
}
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  Object.assign(state, {
    user: "alice",
    org: "one",
    validated: true,
    fetching: false,
    error: null,
  });
  state.list.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  element = document.createElement("div");
  document.body.appendChild(element);
  root = createRoot(element);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  element.remove();
});
const privateLink = [
  { id: "private", name: "Customer secret", url: "https://secret.example" },
];

it("does not persist personal URLs and fails closed on an offline reload", async () => {
  state.list.mockResolvedValueOnce(privateLink);
  render();
  await expectText("Customer secret");
  const snapshot = dehydrate(client, {
    shouldDehydrateQuery: (q) =>
      q.state.status === "success" && q.meta?.persist !== false,
  });
  expect(JSON.stringify(snapshot)).not.toContain("secret.example");
  act(() => root.unmount());
  element.remove();
  client.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  hydrate(client, snapshot);
  element = document.createElement("div");
  document.body.appendChild(element);
  root = createRoot(element);
  state.list.mockRejectedValueOnce(new Error("offline"));
  render();
  await expectText("unavailable");
});

it("hides previous links on session revalidation, workspace switch and failed refetch", async () => {
  state.list.mockResolvedValueOnce(privateLink);
  render();
  await expectText("Customer secret");
  state.fetching = true;
  render();
  expect(element.textContent).toBe("loading");
  state.fetching = false;
  state.org = "two";
  state.validated = false;
  render();
  expect(element.textContent).toBe("loading");
  state.validated = true;
  state.list.mockResolvedValueOnce([
    { id: "other", name: "Other", url: "https://other.example" },
  ]);
  render();
  await expectText("Other");
  state.list.mockRejectedValueOnce(new Error("revoked"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["personal-links"] });
    await tick();
  });
  expect(element.textContent).toBe("unavailable");
});

it("does not render a legacy restored personal URL during offline session validation", async () => {
  client.setQueryData(["personal-links", "alice", "one"], privateLink);
  state.validated = false;
  state.error = new Error("offline");
  render();
  await act(tick);
  expect(element.textContent).not.toContain("Customer secret");
  expect(state.list).not.toHaveBeenCalled();
});
