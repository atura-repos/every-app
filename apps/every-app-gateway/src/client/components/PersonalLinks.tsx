import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/client/hooks/useSession";
import {
  createPersonalLink,
  updatePersonalLink,
  deletePersonalLink,
} from "@/serverFunctions/personalPortal";
import { personalLinkFormSchema } from "@/schemas/personalPortal";
import { PersonalLinkList, type PersonalLink } from "./PersonalLinkList";

export function PersonalLinks({
  links,
  showList = true,
}: {
  links: PersonalLink[];
  showList?: boolean;
}) {
  const { data: session } = useSession();
  const client = useQueryClient();
  const [editing, setEditing] = useState<PersonalLink | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (window.location.hash === "#add-personal-link") {
      nameInput.current?.focus();
    }
  }, []);
  const reset = () => {
    setEditing(null);
    setName("");
    setUrl("");
    setError("");
  };
  const refresh = () =>
    client.invalidateQueries({
      queryKey: [
        "personal-links",
        session?.user.id,
        session?.session.activeOrganizationId,
      ],
    });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = personalLinkFormSchema.safeParse({ name, url });
    if (!parsed.success) {
      setError("Enter a name and a public HTTPS URL without credentials.");
      return;
    }
    setBusy(true);
    try {
      if (editing)
        await updatePersonalLink({ data: { id: editing.id, ...parsed.data } });
      else await createPersonalLink({ data: parsed.data });
      await refresh();
      reset();
    } catch {
      setError("Could not save this link. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (link: PersonalLink) => {
    if (!window.confirm(`Delete your link “${link.name}”?`)) return;
    setBusy(true);
    try {
      await deletePersonalLink({ data: { id: link.id } });
      await refresh();
      if (editing?.id === link.id) reset();
    } catch {
      toast.error("Could not delete this link.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <section
        id="add-personal-link"
        aria-label="Add a personal link"
        className="rounded-xl border bg-card p-4"
      >
        <h2 className="font-semibold">
          {editing ? "Edit personal link" : "Add a personal link"}
        </h2>
        <p className="text-xs text-muted-foreground">
          Only you can see this link in this workspace. The destination manages
          its own access.
        </p>
        <form
          onSubmit={(event) => void submit(event)}
          className="mt-3 flex flex-wrap gap-2"
        >
          <input
            ref={nameInput}
            aria-label="Link name"
            placeholder="Name"
            className="rounded border bg-background p-2"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <input
            aria-label="HTTPS address"
            placeholder="https://example.org"
            type="url"
            className="min-w-60 flex-1 rounded border bg-background p-2"
            value={url}
            maxLength={2048}
            onChange={(event) => setUrl(event.target.value)}
            required
          />
          <button className="rounded border px-3" type="submit" disabled={busy}>
            {editing ? "Save link" : "Add link"}
          </button>
          {editing && (
            <button type="button" onClick={reset}>
              Cancel
            </button>
          )}
        </form>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </section>
      {showList && (
        <PersonalLinkList
          links={links}
          onEdit={(link) => {
            setEditing(link);
            setName(link.name);
            setUrl(link.url);
            setError("");
          }}
          onDelete={(link) => void remove(link)}
        />
      )}
    </div>
  );
}
