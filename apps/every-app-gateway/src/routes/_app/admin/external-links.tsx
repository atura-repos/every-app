import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useSession } from "@/client/hooks/useSession";
import { useExternalLinks } from "@/client/hooks/useExternalLinks";
import { ExternalLinkList } from "@/client/components/ExternalLinkList";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { getRuleErrorMessage } from "@/client/errors";
import {
  createExternalLink,
  updateExternalLink,
  deleteExternalLink,
} from "@/serverFunctions/externalLinks";

export const Route = createFileRoute("/_app/admin/external-links")({
  component: ExternalLinksAdmin,
});

function ExternalLinksAdmin() {
  const { data: session } = useSession();
  const orgId = session?.session.activeOrganizationId;
  const { data: links, isPending, isError, refetch } = useExternalLinks();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["external-links", orgId] });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (editing)
        await updateExternalLink({ data: { id: editing, name, url } });
      else await createExternalLink({ data: { name, url } });
      setEditing(null);
      setName("");
      setUrl("");
      await refresh();
      toast.success("External link saved");
    } catch (error) {
      toast.error(getRuleErrorMessage(error, "Could not save external link"));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string, label: string) => {
    if (!window.confirm(`Delete external link “${label}”?`)) return;
    setBusy(true);
    try {
      await deleteExternalLink({ data: { id } });
      if (editing === id) {
        setEditing(null);
        setName("");
        setUrl("");
      }
      await refresh();
      toast.success("External link deleted");
    } catch (error) {
      toast.error(getRuleErrorMessage(error, "Could not delete external link"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold">External links</h2>
        <p className="text-sm text-muted-foreground">
          Bookmarks for members of this workspace. Destinations are independent
          sites; adding a link does not deploy an app or grant access to it.
        </p>
      </header>
      <form
        onSubmit={(event) => void save(event)}
        className="flex flex-wrap items-end gap-3"
        aria-label={editing ? "Edit external link" : "Add external link"}
      >
        <label className="space-y-1 text-sm">
          Name
          <Input
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="min-w-64 flex-1 space-y-1 text-sm">
          HTTPS URL
          <Input
            required
            type="url"
            maxLength={2048}
            placeholder="https://example.org/"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={busy}>
          {editing ? "Save changes" : "Add link"}
        </Button>
        {editing ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setEditing(null);
              setName("");
              setUrl("");
            }}
          >
            Cancel
          </Button>
        ) : null}
      </form>
      {isError ? (
        <p role="alert">
          Could not load external links.{" "}
          <Button variant="outline" onClick={() => void refetch()}>
            Retry
          </Button>
        </p>
      ) : null}
      {isPending ? <p>Loading external links…</p> : null}
      {links?.length === 0 ? <p>No external links yet.</p> : null}
      {links?.length ? (
        <ul className="space-y-2">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
            >
              <span className="min-w-0 flex-1">
                <strong className="block">{link.name}</strong>
                <span className="block truncate text-sm text-muted-foreground">
                  {link.url}
                </span>
              </span>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setEditing(link.id);
                  setName(link.name);
                  setUrl(link.url);
                }}
              >
                Edit
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void remove(link.id, link.name)}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {links?.length ? <ExternalLinkList links={links} /> : null}
    </div>
  );
}
