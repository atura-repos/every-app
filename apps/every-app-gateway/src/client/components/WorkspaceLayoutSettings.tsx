import { useState } from "react";
import { AppLibraryLayout } from "@/client/hooks/useAppLibrary";
import { removeCollection, resetLauncher } from "@/client/lib/launcherLayout";
import type { PortalPreferences } from "@/server/repositories/PersonalPortalRepository";

type Props = {
  preferences: PortalPreferences;
  layout: AppLibraryLayout;
  onUpdate: (fn: (current: PortalPreferences) => PortalPreferences) => void;
  disabled?: boolean;
};

export function WorkspaceLayoutSettings({
  preferences,
  layout,
  onUpdate,
  disabled = false,
}: Props) {
  const [name, setName] = useState("");
  return (
    <div className="space-y-4">
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="App layout"
      >
        {([AppLibraryLayout.Grid, AppLibraryLayout.List] as const).map(
          (view) => (
            <button
              key={view}
              type="button"
              className="min-h-10 rounded border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
              disabled={disabled}
              aria-pressed={layout === view}
              onClick={() =>
                onUpdate((current) =>
                  current.layout === view
                    ? current
                    : { ...current, layout: view },
                )
              }
            >
              {view === AppLibraryLayout.Grid ? "Grid view" : "List view"}
            </button>
          ),
        )}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Collections</h3>
        <p className="text-sm text-muted-foreground">
          Organize shortcuts into collections on My workspace. Deleting a
          collection moves its items to Other and keeps pins.
        </p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (!trimmed || (preferences.collections ?? []).length >= 20)
              return;
            onUpdate((current) =>
              (current.collections ?? []).length >= 20
                ? current
                : {
                    ...current,
                    collections: [
                      ...(current.collections ?? []),
                      { id: crypto.randomUUID(), name: trimmed },
                    ],
                  },
            );
            setName("");
          }}
        >
          <label className="text-sm">
            New collection{" "}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={64}
              disabled={disabled}
              className="block w-full rounded border bg-card p-2"
            />
          </label>
          <button
            type="submit"
            disabled={
              disabled ||
              !name.trim() ||
              (preferences.collections ?? []).length >= 20
            }
            className="min-h-10 rounded border px-3 py-2 text-sm"
          >
            Add collection
          </button>
        </form>
        {(preferences.collections ?? []).map((collection) => (
          <div
            key={collection.id}
            className="flex flex-wrap items-center gap-2 text-sm"
          >
            <span className="min-w-0 break-words">{collection.name}</span>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Rename ${collection.name}`}
              onClick={() => {
                const next = window
                  .prompt("Collection name", collection.name)
                  ?.trim();
                if (next && next.length <= 64)
                  onUpdate((current) => ({
                    ...current,
                    collections: (current.collections ?? []).map((item) =>
                      item.id === collection.id
                        ? { ...item, name: next }
                        : item,
                    ),
                  }));
              }}
              className="min-h-10 rounded border px-3 py-2"
            >
              Rename
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Delete ${collection.name}`}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete ${collection.name}? Items return to Other; pins stay.`,
                  )
                )
                  onUpdate((current) =>
                    removeCollection(current, collection.id),
                  );
              }}
              className="min-h-10 rounded border px-3 py-2"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled}
        className="min-h-10 rounded border px-3 py-2 text-sm"
        onClick={() => {
          if (
            window.confirm(
              "Reset your pins, order, collections and layout? Your links and Atura publications stay.",
            )
          )
            onUpdate(resetLauncher);
        }}
      >
        Reset layout
      </button>
    </div>
  );
}
