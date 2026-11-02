import {
  index,
  primaryKey,
  sqliteTable,
  text,
  integer,
} from "drizzle-orm/sqlite-core";
import { organizations, users } from "./auth.schema";

/** Personal bookmarks never confer access to their destinations. */
export const personalLinks = sqliteTable(
  "personal_links",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("personal_links_owner_idx").on(t.organizationId, t.userId)],
);

export const portalPreferences = sqliteTable(
  "portal_preferences",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pinnedIds: text("pinned_ids", { mode: "json" }).$type<string[]>().notNull(),
    orderedIds: text("ordered_ids", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    layout: text("layout", { enum: ["grid", "list"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })],
);
