import {
  integer,
  index,
  sqliteTable,
  text,
  uniqueIndex,
  primaryKey,
  foreignKey,
} from "drizzle-orm/sqlite-core";
import { organizations, users } from "./auth.schema";
import { groups } from "./groups.schema";

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
    // Existing rows default to everyone, preserving their visibility.
    everyone: integer("everyone", { mode: "boolean" }).default(true).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("external_links_organization_idx").on(table.organizationId),
    uniqueIndex("external_links_id_org_unique").on(
      table.id,
      table.organizationId,
    ),
  ],
);

export const externalLinkUsers = sqliteTable(
  "external_link_users",
  {
    linkId: text("link_id").notNull(),
    organizationId: text("organization_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.linkId, table.userId] }),
    foreignKey({
      columns: [table.linkId, table.organizationId],
      foreignColumns: [externalLinks.id, externalLinks.organizationId],
      name: "external_link_users_link_org_fk",
    }).onDelete("cascade"),
    index("external_link_users_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
  ],
);

export const externalLinkGroups = sqliteTable(
  "external_link_groups",
  {
    linkId: text("link_id").notNull(),
    organizationId: text("organization_id").notNull(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.linkId, table.groupId] }),
    foreignKey({
      columns: [table.linkId, table.organizationId],
      foreignColumns: [externalLinks.id, externalLinks.organizationId],
      name: "external_link_groups_link_org_fk",
    }).onDelete("cascade"),
    index("external_link_groups_org_group_idx").on(
      table.organizationId,
      table.groupId,
    ),
  ],
);
