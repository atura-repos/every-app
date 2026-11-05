// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { PersonalLinks } from "./PersonalLinks";

const state = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/serverFunctions/personalPortal", () => ({
  createPersonalLink: state.create,
  updatePersonalLink: vi.fn(),
  deletePersonalLink: vi.fn(),
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  window.history.replaceState(null, "", "/");
  state.create.mockReset();
});

it("focuses the add-link name after the form mounts for a delayed hash navigation", () => {
  window.history.replaceState(null, "", "/settings#add-personal-link");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient();
  try {
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <PersonalLinks links={[]} userId="member-1" orgId="org-1" />
        </QueryClientProvider>,
      ),
    );
    expect(document.activeElement).toBe(
      container.querySelector('input[aria-label="Link name"]'),
    );
  } finally {
    act(() => root.unmount());
    client.clear();
    container.remove();
  }
});
