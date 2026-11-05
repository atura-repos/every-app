import { createFileRoute, Link } from "@tanstack/react-router";
import { PersonalLinks } from "@/client/components/PersonalLinks";
import { ThemePreferenceRadio } from "@/client/components/ThemePreferenceMenuItems";
import {
  Page,
  PageHeader,
  SectionHeader,
} from "@/client/components/PageHeader";
import { ErrorState } from "@/client/components/ErrorState";
import { AppLibraryLayout, useAppLibrary } from "@/client/hooks/useAppLibrary";
import { usePersonalLinks } from "@/client/hooks/usePersonalLinks";
import { useSession } from "@/client/hooks/useSession";

export const Route = createFileRoute("/_app/settings/")({
  component: SettingsPage,
});

function SettingsPage() {
  const sessionQuery = useSession();
  const session = sessionQuery.data;
  const { data: links, isError: linksError, refetch } = usePersonalLinks();
  const identityReady = Boolean(
    sessionQuery.isFetchedAfterMount &&
      !sessionQuery.isFetching &&
      !sessionQuery.error &&
      session?.user.id &&
      session.session.activeOrganizationId,
  );
  const {
    layout,
    setLayout,
    isLoading: layoutLoading,
    isError: layoutError,
  } = useAppLibrary();
  return (
    <Page>
      <PageHeader
        title="Personal settings"
        description="Your settings for this workspace, separate from workspace administration."
      />
      <section className="space-y-3" aria-label="Personal links settings">
        <SectionHeader title="Personal links" />
        {sessionQuery.error ? (
          <ErrorState
            title="Could not verify your workspace"
            message="Please try again before managing personal links."
            onRetry={() => sessionQuery.refetch()}
          />
        ) : sessionQuery.isFetchedAfterMount &&
          !sessionQuery.isFetching &&
          !session?.session.activeOrganizationId ? (
          <p role="status">Select a workspace to manage personal links.</p>
        ) : !identityReady ? (
          <p role="status">
            Checking your workspace before loading personal links…
          </p>
        ) : null}
        {identityReady && linksError ? (
          <ErrorState
            title="Failed to load personal links"
            message="Your links could not be listed. You can still add a link or try again."
            onRetry={() => void refetch()}
          />
        ) : null}
        {identityReady && !links && !linksError ? (
          <p role="status">Loading personal links…</p>
        ) : null}
        {identityReady ? (
          <PersonalLinks
            key={`${session?.user.id}:${session?.session.activeOrganizationId}`}
            links={links ?? []}
            showList={Boolean(links)}
          />
        ) : null}
        {identityReady && links?.length === 0 ? (
          <p>No personal links yet. Add your first link above.</p>
        ) : null}
      </section>
      <section className="space-y-3" aria-label="Home page settings">
        <SectionHeader title="Home page" />
        <p className="text-sm text-muted-foreground">
          Choose how your apps appear in this workspace. Pin and reorder apps on
          the home page.
        </p>
        {layoutError ? (
          <p role="alert">Could not load your display preference.</p>
        ) : null}
        <div className="flex gap-2" role="group" aria-label="App layout">
          <button
            type="button"
            className="rounded border px-3 py-2"
            disabled={layoutLoading || layoutError}
            aria-pressed={layout === AppLibraryLayout.Grid}
            onClick={() => setLayout(AppLibraryLayout.Grid)}
          >
            Grid view
          </button>
          <button
            type="button"
            className="rounded border px-3 py-2"
            disabled={layoutLoading || layoutError}
            aria-pressed={layout === AppLibraryLayout.List}
            onClick={() => setLayout(AppLibraryLayout.List)}
          >
            List view
          </button>
        </div>
        <div className="max-w-xs space-y-2">
          <h3 className="text-sm font-medium">Theme</h3>
          <ThemePreferenceRadio />
          <p className="text-xs text-muted-foreground">
            Saved in this browser and shared with apps on this portal.
          </p>
        </div>
      </section>
      <section className="space-y-3" aria-label="Account connections">
        <SectionHeader title="Connections" />
        <div className="flex flex-wrap gap-4 text-sm">
          <Link to="/settings/accounts" className="underline">
            Connected accounts
          </Link>
          <Link to="/settings/connections" className="underline">
            AI connections
          </Link>
        </div>
      </section>
    </Page>
  );
}
