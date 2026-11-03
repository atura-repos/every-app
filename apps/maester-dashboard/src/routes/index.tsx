import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { DashboardView } from "@/components/DashboardView";
import { getDashboard } from "@/serverFunctions/dashboard";

const search = z.object({
  tenant: z.string().min(1).max(128).optional(),
  suite: z.enum(["daily", "cis"]).default("daily"),
});
export const Route = createFileRoute("/")({
  validateSearch: (raw) => search.parse(raw),
  loaderDeps: ({ search: { tenant, suite } }) => ({ tenant, suite }),
  loader: ({ deps }) => getDashboard({ data: deps }),
  head: () => ({
    meta: [
      { title: "Maester-dashboard | Atura" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => <DashboardView {...Route.useLoaderData()} />,
});
