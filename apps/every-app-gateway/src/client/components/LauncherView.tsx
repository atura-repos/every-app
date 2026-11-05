import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Bookmark, Link2, Pin, PinOff, ArrowUpRight } from "lucide-react";
import { AppListItem } from "./AppListItem";
import { AppLibraryLayout } from "@/client/hooks/useAppLibrary";
import {
  projectLauncher,
  type LauncherItem,
  type LauncherKind,
  type LauncherSource,
} from "@/client/lib/launcherItems";
import { moveLauncherItem } from "@/client/lib/launcherLayout";
import type { PortalPreferences } from "@/server/repositories/PersonalPortalRepository";
import type { UserAccessApp } from "@/types/app";
import type { personalLinks, externalLinks } from "@/db/schema";

type LinkRow = typeof personalLinks.$inferSelect;
type ExternalRow = typeof externalLinks.$inferSelect;
type Props = {
  apps: UserAccessApp[];
  externalLinks?: ExternalRow[];
  personalLinks?: LinkRow[];
  preferences: PortalPreferences;
  layout: AppLibraryLayout;
  saveStatus?: "" | "saving" | "saved" | "error" | "conflict";
  onUpdate: (fn: (current: PortalPreferences) => PortalPreferences) => void;
  onOpenSetup: (app: UserAccessApp) => void;
  onUseMcp: (app: UserAccessApp) => void;
};

export function LauncherView({
  apps,
  externalLinks = [],
  personalLinks = [],
  preferences,
  layout,
  saveStatus = "",
  onUpdate,
  onOpenSetup,
  onUseMcp,
}: Props) {
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<"all" | "pinned" | LauncherKind>("all");
  const drag = useRef<{
    pointerId: number;
    key: LauncherItem["key"];
    x: number;
    y: number;
    active: boolean;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moveAnnouncement, setMoveAnnouncement] = useState("");
  const focusAfterMove = useRef<LauncherItem["key"] | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusAfterMove.current) return;
    const handle = [
      ...(viewRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-drag-key]",
      ) ?? []),
    ].find((button) => button.dataset.dragKey === focusAfterMove.current);
    if (handle) {
      handle.focus();
      focusAfterMove.current = null;
    }
  }, [preferences]);
  useEffect(
    () => () => {
      drag.current = null;
    },
    [],
  );

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const sources: LauncherSource[] = [
    ...apps.map((app) => ({
      kind: "managed" as const,
      id: app.id,
      name: app.name,
      description: app.description ?? "",
    })),
    ...externalLinks.map((link) => ({
      kind: "external" as const,
      id: link.id,
      name: link.name,
      description: "",
      url: link.url,
    })),
    ...personalLinks.map((link) => ({
      kind: "personal" as const,
      id: link.id,
      name: link.name,
      description: "",
      url: link.url,
    })),
  ];
  const projected = projectLauncher(sources, preferences, search, filter);
  const all = projectLauncher(sources, preferences).items.map(
    (item) => item.key,
  );
  const pinned = new Set(
    preferences.pinnedIds.map((key) =>
      key.includes(":") ? key : `managed:${key}`,
    ),
  );
  const update = (
    fn: (p: PortalPreferences) => PortalPreferences,
    _message: string,
  ) => onUpdate(fn);
  const toggle = (item: LauncherItem) =>
    update(
      (current) => {
        const keys = current.pinnedIds.filter(
          (key) =>
            key !== item.key && !(item.kind === "managed" && key === item.id),
        );
        return {
          ...current,
          pinnedIds: pinned.has(item.key) ? keys : [...keys, item.key],
        };
      },
      `${item.name} ${pinned.has(item.key) ? "unpinned" : "pinned"}`,
    );
  const move = (
    item: LauncherItem,
    direction: -1 | 1,
    section: LauncherItem[],
  ) =>
    update(
      (current) =>
        moveLauncherItem(
          current,
          all,
          item.key,
          direction,
          section.map((x) => x.key),
        ),
      `${item.name} moved ${direction === -1 ? "up" : "down"}`,
    );
  const assign = (item: LauncherItem, collectionId: string) =>
    update(
      (current) => {
        if (
          collectionId &&
          !current.collections?.some((c) => c.id === collectionId)
        )
          return current;
        if ((current.assignments?.[item.key] ?? "") === collectionId)
          return current;
        const assignments = { ...current.assignments };
        if (collectionId) assignments[item.key] = collectionId;
        else delete assignments[item.key];
        return { ...current, assignments };
      },
      `${item.name} moved to ${collectionId ? "collection" : "Other"}`,
    );
  const destinationAt = (x: number, y: number) => {
    const target = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-drop-collection]");
    const id = target?.dataset.dropCollection;
    return id !== undefined &&
      (id === "" || preferences.collections?.some((c) => c.id === id))
      ? id
      : null;
  };
  const startDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    item: LauncherItem,
  ) => {
    if (event.button !== 0 || saveStatus === "conflict") return;
    drag.current = {
      pointerId: event.pointerId,
      key: item.key,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (
      !current.active &&
      Math.hypot(event.clientX - current.x, event.clientY - current.y) < 8
    )
      return;
    current.active = true;
    event.preventDefault();
    setDropTarget(destinationAt(event.clientX, event.clientY));
  };
  const endDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    item: LauncherItem,
  ) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setDropTarget(null);
    if (!current.active || current.key !== item.key) return;
    event.preventDefault();
    const id = destinationAt(event.clientX, event.clientY);
    if (id === null || (preferences.assignments?.[item.key] ?? "") === id)
      return;
    focusAfterMove.current = item.key;
    assign(item, id);
    setMoveAnnouncement(
      `${item.name} moved to ${id ? preferences.collections?.find((c) => c.id === id)?.name : "Other"}`,
    );
  };
  const render = (item: LauncherItem, section: LauncherItem[]) => {
    const app =
      item.kind === "managed" ? apps.find((x) => x.id === item.id) : undefined;
    const collection = preferences.assignments?.[item.key] ?? "";
    const actions = (
      <div className="flex flex-wrap items-center gap-2 py-2 text-xs">
        {!app && (
          <button
            type="button"
            aria-pressed={pinned.has(item.key)}
            onClick={() => toggle(item)}
            className="rounded border px-2 py-1.5"
          >
            {pinned.has(item.key) ? (
              <PinOff className="inline size-4" aria-hidden />
            ) : (
              <Pin className="inline size-4" aria-hidden />
            )}{" "}
            {pinned.has(item.key) ? "Unpin" : "Pin"} {item.name}
          </button>
        )}
        <label>
          Collection for {item.name}{" "}
          <select
            aria-label={`Collection for ${item.name}`}
            value={collection}
            onChange={(e) => assign(item, e.target.value)}
            className="max-w-full rounded border bg-card p-1"
          >
            <option value="">Other</option>
            {(preferences.collections ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          data-drag-key={item.key}
          aria-label={`Drag ${item.name} to a collection`}
          aria-describedby="collection-drag-help"
          onPointerDown={(e) => startDrag(e, item)}
          onPointerMove={moveDrag}
          onPointerUp={(e) => endDrag(e, item)}
          onPointerCancel={() => {
            drag.current = null;
            setDropTarget(null);
          }}
          className="min-h-11 rounded border px-2 py-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 touch-none select-none motion-reduce:transition-none"
        >
          Drag {item.name}
        </button>
        {!app && (
          <>
            <button
              type="button"
              onClick={() => move(item, -1, section)}
              disabled={section[0]?.key === item.key}
              aria-label={`Move ${item.name} up`}
              className="rounded border px-2 py-1.5"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(item, 1, section)}
              disabled={section.at(-1)?.key === item.key}
              aria-label={`Move ${item.name} down`}
              className="rounded border px-2 py-1.5"
            >
              ↓
            </button>
          </>
        )}
      </div>
    );
    if (app)
      return (
        <li key={item.key} className="min-w-0">
          <AppListItem
            app={app}
            pinned={pinned.has(item.key)}
            onTogglePin={() => toggle(item)}
            onMoveUp={() => move(item, -1, section)}
            onMoveDown={() => move(item, 1, section)}
            onOpenSetup={() => onOpenSetup(app)}
            onUseMcp={() => onUseMcp(app)}
            layout={layout}
          />
          {actions}
        </li>
      );
    const host = (() => {
      try {
        return new URL(item.url ?? "").host;
      } catch {
        return "Destination unavailable";
      }
    })();
    const Icon = item.kind === "personal" ? Bookmark : Link2;
    return (
      <li key={item.key} className="min-w-0 rounded-xl border bg-card p-4">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 items-center gap-3 rounded focus-visible:outline-2 focus-visible:outline-offset-2"
          aria-label={`Open ${item.name} in a new tab`}
        >
          <Icon className="size-6 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <strong className="block break-words">{item.name}</strong>
            <span className="block break-all text-xs text-muted-foreground">
              {item.kind === "personal" ? "Own link" : "Atura link"} · {host} ·
              destination not verified
            </span>
          </span>
          <ArrowUpRight className="size-4 shrink-0" aria-hidden />
        </a>
        {actions}
      </li>
    );
  };
  return (
    <div ref={viewRef} className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <a
          href="/settings#add-personal-link"
          className="rounded border px-3 py-2 text-sm"
        >
          Add my own link
        </a>
        <span className="text-sm text-muted-foreground">
          Only for me in this workspace
        </span>
        <a
          href="/settings#home-layout"
          className="min-h-10 rounded border px-3 py-2 text-sm"
        >
          Manage layout and collections
        </a>
      </div>
      <label className="block max-w-sm text-sm">
        Search name or description{" "}
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSearch("");
              searchRef.current?.blur();
            }
          }}
          className="mt-1 w-full rounded border bg-card p-2"
        />
      </label>
      <button
        type="button"
        onClick={() => setSearch("")}
        disabled={!search}
        className="rounded border px-2 py-1.5 text-sm"
      >
        Clear search
      </button>
      <div aria-label="Item filters" className="flex flex-wrap gap-2">
        {(
          [
            ["all", "All"],
            ["pinned", "Pinned"],
            ["managed", "Managed apps"],
            ["external", "Atura links"],
            ["personal", "Own links"],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`rounded border px-2 py-1.5 text-sm ${filter === value ? "bg-accent" : ""}`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setFilter("all")}
          disabled={filter === "all"}
          className="rounded border px-2 py-1.5 text-sm"
        >
          Clear filters
        </button>
      </div>
      <p role="status">
        {projected.count} {search || filter !== "all" ? "results" : "items"}
        {saveStatus === "saving" ? " · Saving layout…" : ""}
        {saveStatus === "saved" ? " · Layout saved" : ""}
        {saveStatus === "conflict"
          ? " · Layout changed in another browser"
          : ""}
        {saveStatus === "error" ? " · Could not save layout" : ""}
      </p>
      <p id="collection-drag-help" className="text-xs text-muted-foreground">
        Drag a shortcut by its handle to a collection or Other. Use its
        Collection menu instead with a keyboard.
      </p>
      <p role="status" aria-live="polite">
        {saveStatus === "conflict" || saveStatus === "error"
          ? ""
          : moveAnnouncement}
      </p>
      {projected.count === 0 && (
        <p>{search || filter !== "all" ? "No results" : "No items yet"}</p>
      )}
      {projected.sections.map((section) => (
        <section
          key={section.id}
          aria-label={section.name}
          data-drop-collection={
            section.id === "other"
              ? ""
              : section.id === "pinned" || section.id === "results"
                ? undefined
                : section.id
          }
          className={`space-y-2 rounded-lg ${dropTarget !== null && dropTarget === (section.id === "other" ? "" : section.id) && section.id !== "pinned" && section.id !== "results" ? "outline-2 outline-offset-2 outline-primary" : ""}`}
        >
          <h2 className="text-lg font-semibold">{section.name}</h2>
          {section.items.length ? (
            <ul
              className={
                layout === AppLibraryLayout.List
                  ? "grid gap-4"
                  : "grid gap-4 md:grid-cols-2 xl:grid-cols-3"
              }
            >
              {section.items.map((item) => render(item, section.items))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing here yet</p>
          )}
        </section>
      ))}
    </div>
  );
}
