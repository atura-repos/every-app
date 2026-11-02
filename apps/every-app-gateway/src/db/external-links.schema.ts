import { integer, index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { organizations } from "./auth.schema";

/** Navigation-only links, deliberately unrelated to app registry and grants. */
export const externalLinks = sqliteTable(
  "external_links",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("external_links_organization_idx").on(table.organizationId),
  ],
);
