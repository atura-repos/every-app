import { QueryClient, dehydrate } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { shouldPersistQuery } from "./persister";

it("excludes sensitive legacy snapshots even when their queries lack a meta flag", () => {
  const client = new QueryClient();
  client.setQueryData(["user-apps"], [{ name: "Secret app" }]);
  client.setQueryData(["portal-preferences", "alice", "one"], {
    pinnedIds: ["secret"],
  });
  client.setQueryData(
    ["personal-links", "alice", "one"],
    [{ url: "https://secret.example" }],
  );
  client.setQueryData(
    ["external-links", "one", "alice"],
    [{ url: "https://restricted.example" }],
  );
  client.setQueryData(["auth", "sign-in-methods"], { enabled: true });
  const snapshot = dehydrate(client, {
    shouldDehydrateQuery: shouldPersistQuery,
  });
  expect(snapshot.queries.map((query) => query.queryKey)).toEqual([
    ["auth", "sign-in-methods"],
  ]);
  client.clear();
});

it("honors explicit opt-out metadata on all other successful queries", () => {
  const client = new QueryClient();
  client
    .getQueryCache()
    .build(client, { queryKey: ["other"], meta: { persist: false } })
    .setData("private");
  expect(
    dehydrate(client, { shouldDehydrateQuery: shouldPersistQuery }).queries,
  ).toEqual([]);
  client.clear();
});
