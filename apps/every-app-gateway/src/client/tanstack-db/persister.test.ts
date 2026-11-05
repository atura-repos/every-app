import { expect, it } from "vitest";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import { persistQueryClientSave } from "@tanstack/react-query-persist-client";
import { gatewayPersistOptions } from "./persister";

it("never persists private query keys or payloads through the gateway's actual dehydration options", async () => {
  const client = new QueryClient();
  const privateMarker = "SYNTHETIC-PRIVATE-USER-AND-ORG";
  const privateUrl = "https://private.example.test/secret-link";
  const sensitive = [
    "external-links",
    "personal-links",
    "portal-preferences",
    "user-apps",
  ];
  for (const prefix of sensitive) {
    // No meta.persist=false: the denylist must protect older callers too.
    client.setQueryData([prefix, privateMarker], {
      ownerId: privateMarker,
      url: privateUrl,
    });
  }
  client.setQueryData(["ordinary", "safe"], { value: "public-data" });
  client
    .getQueryCache()
    .build(client, {
      queryKey: ["explicit-opt-out"],
      meta: { persist: false },
    })
    .setData({ value: privateMarker });

  const saved: string[] = [];
  const options = {
    ...gatewayPersistOptions,
    persister: {
      persistClient: async (persisted: unknown) => {
        saved.push(JSON.stringify(persisted));
      },
      restoreClient: async () => undefined,
      removeClient: async () => undefined,
    },
  };
  const dehydrated = dehydrate(client, options.dehydrateOptions);
  await persistQueryClientSave({
    // The workspace resolves two compatible query-core patch versions.
    queryClient: client as unknown as Parameters<
      typeof persistQueryClientSave
    >[0]["queryClient"],
    ...options,
  });
  expect(dehydrated.queries).toHaveLength(1);
  expect(dehydrated.queries[0]?.queryKey).toEqual(["ordinary", "safe"]);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toContain("public-data");
  expect(saved[0]).not.toContain(privateMarker);
  expect(saved[0]).not.toContain(privateUrl);
  for (const prefix of sensitive) expect(saved[0]).not.toContain(prefix);
});
