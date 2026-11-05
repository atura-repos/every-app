import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsDiagnostics } from "./SettingsDiagnostics";
import { settingsDiagnosticEnabled } from "./settingsDiagnosticGate";

it("fails closed except for the exact staging origin and explicit settings flag", () => {
  expect(
    settingsDiagnosticEnabled(
      "https://stage-apps.atura.nl",
      "/settings",
      "?atura-diagnostics=1",
    ),
  ).toBe(true);
  for (const origin of [
    "https://apps.atura.nl",
    "https://stage-apps.atura.nl.evil.test",
    "http://stage-apps.atura.nl",
  ]) {
    expect(
      settingsDiagnosticEnabled(origin, "/settings", "?atura-diagnostics=1"),
    ).toBe(false);
  }
  expect(
    settingsDiagnosticEnabled(
      "https://stage-apps.atura.nl",
      "/",
      "?atura-diagnostics=1",
    ),
  ).toBe(false);
  expect(
    settingsDiagnosticEnabled("https://stage-apps.atura.nl", "/settings", ""),
  ).toBe(false);
});

it("renders only allowlisted statuses even with private data and hostile errors in query state", () => {
  const client = new QueryClient();
  const secret = "SECRET-NEVER-RENDER";
  client.setQueryData(
    ["personal-links", secret, secret],
    [{ id: secret, url: `https://${secret}.test` }],
  );
  client.setQueryData(["portal-preferences", secret, secret], {
    pinnedIds: [secret],
    orderedIds: [secret],
  });
  const session = {
    data: {
      user: { id: secret, email: `${secret}@example.test` },
      session: { activeOrganizationId: secret, token: secret },
    },
    isFetchedAfterMount: false,
    isFetching: true,
    error: Object.assign(new Error(secret), {
      code: "NETWORK_ERROR",
      token: secret,
    }),
  };
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <SettingsDiagnostics
        session={
          session as unknown as React.ComponentProps<
            typeof SettingsDiagnostics
          >["session"]
        }
      />
    </QueryClientProvider>,
  );
  expect(html).toContain("isFetchedAfterMount");
  expect(html).toContain("NETWORK_ERROR");
  expect(html).toContain("personalLinks");
  expect(html).toContain("preferences");
  expect(html).not.toContain(secret);
  expect(html).not.toContain("https://");
  expect(html).not.toContain("email");
  expect(html).not.toContain("token");
  // An attacker-controlled error.code must not be copied into the panel.
  session.error.code = secret;
  const hostile = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <SettingsDiagnostics
        session={
          session as unknown as React.ComponentProps<
            typeof SettingsDiagnostics
          >["session"]
        }
      />
    </QueryClientProvider>,
  );
  expect(hostile).toContain("OTHER");
  expect(hostile).not.toContain(secret);
});
