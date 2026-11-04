import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useQuery } from "@tanstack/react-query";
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
  externalLinkAccessOptions,
  getExternalLinkAccess,
} from "@/serverFunctions/externalLinks";

export const Route = createFileRoute("/_app/admin/external-links")({
  component: ExternalLinksAdmin,
});

function ExternalLinksAdmin() {
  const {
    data: session,
    isFetchedAfterMount,
    isFetching: sessionFetching,
    error: sessionError,
  } = useSession();
  const orgId = session?.session.activeOrganizationId;
  const userId = session?.user.id;
  const validated = isFetchedAfterMount && !sessionFetching && !sessionError;
  const { data: links, isPending, isError, refetch } = useExternalLinks();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [confirmedHostname, setConfirmedHostname] = useState("");
  const [busy, setBusy] = useState(false);
  const [everyone, setEveryone] = useState<boolean | null>(null);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const {
    data: cachedChoices,
    isFetchedAfterMount: choicesFetchedAfterMount,
    isFetching: choicesFetching,
    isError: choicesError,
    refetch: retryChoices,
  } = useQuery({
    queryKey: ["external-link-access-options", orgId, userId],
    enabled: Boolean(orgId && userId && validated),
    meta: { persist: false },
    queryFn: () => externalLinkAccessOptions(),
  });
  const choices =
    validated && choicesFetchedAfterMount && !choicesFetching && !choicesError
      ? cachedChoices
      : undefined;
  const clear = () => {
    setEditing(null);
    setName("");
    setUrl("");
    setConfirmedHostname("");
    setEveryone(null);
    setUserIds([]);
    setGroupIds([]);
  };
  const edit = async (link: { id: string; name: string; url: string }) => {
    setBusy(true);
    try {
      const access = await getExternalLinkAccess({ data: { id: link.id } });
      setEditing(link.id);
      setName(link.name);
      setUrl(link.url);
      setConfirmedHostname("");
      setEveryone(access.everyone);
      setUserIds(access.userIds);
      setGroupIds(access.groupIds);
    } catch (error) {
      toast.error(getRuleErrorMessage(error, "Could not load link access"));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (ids: string[], set: (value: string[]) => void, id: string) =>
    set(ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["external-links", orgId] });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (everyone === null) {
      toast.error("Choose who can see this link before publishing");
      return;
    }
    if (editing) {
      let host = "";
      try {
        host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
      } catch {
        /* Server validates URL too. */
      }
      if (!host || confirmedHostname.trim().toLowerCase() !== host) {
        toast.error("Re-enter the destination hostname to confirm");
        return;
      }
    }
    if (!everyone && !choices) {
      toast.error("Load members and groups before saving access");
      return;
    }
    setBusy(true);
    try {
      const access = {
        everyone,
        userIds: everyone ? [] : userIds,
        groupIds: everyone ? [] : groupIds,
      };
      if (editing)
        await updateExternalLink({
          data: { id: editing, name, url, access, confirmedHostname },
        });
      else await createExternalLink({ data: { name, url, access } });
      clear();
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
      if (editing === id) clear();
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
        {editing ? (
          <label className="space-y-1 text-sm">
            Re-enter destination hostname to confirm (not the full URL)
            <Input
              required
              autoComplete="off"
              value={confirmedHostname}
              onChange={(event) => setConfirmedHostname(event.target.value)}
            />
          </label>
        ) : null}
        {everyone === null ? (
          <p className="w-full text-sm">
            Choose an audience before publishing this link.
          </p>
        ) : null}
        <Button
          type="button"
          variant={everyone === true ? "default" : "outline"}
          onClick={() => setEveryone(true)}
        >
          Everyone
        </Button>
        <Button
          type="button"
          variant={everyone === false ? "default" : "outline"}
          onClick={() => setEveryone(false)}
        >
          Selected members and groups
        </Button>
        {everyone === false ? (
          <div className="w-full space-y-2" aria-label="External link access">
            {choicesError ? (
              <p role="alert">
                Could not load access choices.{" "}
                <Button type="button" onClick={() => void retryChoices()}>
                  Retry
                </Button>
              </p>
            ) : null}
            {!choices && !choicesError ? (
              <p>Loading members and groups…</p>
            ) : null}
            {choices ? (
              <>
                <fieldset className="flex flex-wrap gap-3">
                  <legend>Members</legend>
                  {choices.people.map((person) => (
                    <label key={person.id} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={userIds.includes(person.id)}
                        onChange={() => toggle(userIds, setUserIds, person.id)}
                      />
                      {person.name} ({person.email})
                    </label>
                  ))}
                </fieldset>
                <fieldset className="flex flex-wrap gap-3">
                  <legend>Gateway groups</legend>
                  {choices.groups.map((group) => (
                    <label key={group.id} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={groupIds.includes(group.id)}
                        onChange={() => toggle(groupIds, setGroupIds, group.id)}
                      />
                      {group.name}
                    </label>
                  ))}
                </fieldset>
                <p className="text-sm text-muted-foreground">
                  Only selected members and group members see this link. This
                  does not grant access to its destination.
                </p>
              </>
            ) : null}
          </div>
        ) : null}
        <Button
          type="submit"
          disabled={busy || (everyone === false && !choices)}
        >
          {editing ? "Save changes" : "Add link"}
        </Button>
        {editing ? (
          <Button type="button" variant="outline" onClick={clear}>
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
                  void edit(link);
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
