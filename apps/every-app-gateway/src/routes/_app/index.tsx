import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useSession } from "@/client/hooks/useSession";
import { useState, useEffect, useRef } from "react";
import { z } from "zod";
import { PWAInstallModal } from "@/client/components/PWAInstallModal";
import { AppGallery } from "@/client/components/onboarding/AppGallery";
import { BuildYourOwnDialog } from "@/client/components/onboarding/BuildYourOwnDialog";
import { FeaturedAppDialog } from "@/client/components/onboarding/FeaturedAppDialog";
import { AppSetupDialog } from "@/client/components/AppSetupDialog";
import { McpAppDialog } from "@/client/components/McpAppDialog";
import { PageHeader } from "@/client/components/PageHeader";
import { LauncherView } from "@/client/components/LauncherView";
import { Button } from "@/client/components/ui/button";
import { useAppLibrary } from "@/client/hooks/useAppLibrary";
import { useSetupDialog } from "@/client/hooks/useSetupDialog";
import { useMcpParam, useSetupParam } from "@/client/hooks/useSetupParam";
import type { FeaturedApp } from "@/client/lib/featuredApps";
import { authClient } from "@/client/auth-client";
import { isMcpApp } from "@/client/lib/appStatus";
import type { UserAccessApp } from "@/types/app";
import { userAppsCollection } from "@/client/tanstack-db";
import { useExternalLinks } from "@/client/hooks/useExternalLinks";
import { usePersonalLinks } from "@/client/hooks/usePersonalLinks";

const searchSchema = z.object({
  pwa: z
    .union([z.boolean(), z.literal("true"), z.literal("false")])
    .transform((value) => value === true || value === "true")
    .optional()
    .catch(undefined),
  setup: z.string().optional().catch(undefined),
  mcp: z.string().optional().catch(undefined),
});
export const Route = createFileRoute("/_app/")({
  validateSearch: searchSchema,
  component: App,
});
function refetchApps() {
  return userAppsCollection.utils.refetch();
}
function App() {
  const session = useSession();
  const { pwa: pwaParam, setup: setupParam, mcp: mcpParam } = Route.useSearch();
  const [showPWAInstallModal, setShowPWAInstallModal] = useState(false);
  const [pickedApp, setPickedApp] = useState<FeaturedApp | null>(null);
  const [buildOpen, setBuildOpen] = useState(false);
  const [mcpApp, setMcpApp] = useState<UserAccessApp | null>(null);
  const navigate = useNavigate();
  const hasStrippedPwaParam = useRef(false);
  const { data: activeMemberRole, isPending: isMemberRolePending } =
    authClient.useActiveMemberRole();
  const userCanManageApps =
    activeMemberRole?.role === "owner" || activeMemberRole?.role === "admin";
  const {
    apps,
    isLoading,
    isError,
    preferences,
    layout,
    updateLauncher,
    conflict,
    reloadConflict,
    reapplyConflict,
  } = useAppLibrary();
  const selectedMcpApp =
    !isLoading && !isError && mcpApp
      ? apps.find((app) => app.id === mcpApp.id && isMcpApp(app))
      : undefined;
  useEffect(() => {
    if (mcpApp && !selectedMcpApp) setMcpApp(null);
  }, [mcpApp, selectedMcpApp]);
  const {
    data: personalLinks,
    isError: personalLinksError,
    isPending: personalLinksPending,
    refetch: refetchPersonalLinks,
  } = usePersonalLinks();
  const {
    data: externalLinks,
    isError: linksError,
    isPending: linksPending,
    refetch: refetchLinks,
  } = useExternalLinks();
  const {
    app: setupApp,
    open: openSetup,
    close: closeSetup,
  } = useSetupDialog(apps, refetchApps);
  useEffect(() => {
    if (
      !session.isPending &&
      session.data?.user &&
      !session.data.session.activeOrganizationId
    )
      void navigate({ to: "/organizations" });
  }, [
    navigate,
    session.data?.session.activeOrganizationId,
    session.data?.user,
    session.isPending,
  ]);
  useEffect(() => {
    if (pwaParam && !hasStrippedPwaParam.current) {
      setShowPWAInstallModal(true);
      hasStrippedPwaParam.current = true;
      void navigate({ to: "/", search: {}, replace: true });
    }
  }, [pwaParam, navigate]);
  useSetupParam({
    setupParam,
    apps,
    loaded: !isLoading && !isError,
    open: openSetup,
    strip: () => void navigate({ to: "/", search: {}, replace: true }),
  });
  useMcpParam({
    mcpParam,
    apps,
    loaded: !isLoading && !isError,
    open: setMcpApp,
    strip: () => void navigate({ to: "/", search: {}, replace: true }),
  });
  if (
    !session.isPending &&
    session.data?.user &&
    !session.data.session.activeOrganizationId
  )
    return null;
  return (
    <div className="px-5 py-5 pb-safe md:px-10 lg:px-12">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader
          title="My workspace"
          actions={
            userCanManageApps ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link to="/admin/apps" />}
                >
                  Install managed app
                </Button>
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link to="/admin/external-links" />}
                >
                  Publish Atura link
                </Button>
              </div>
            ) : null
          }
        />
        {conflict ? (
          <div
            role="alert"
            className="rounded-md border border-destructive p-4"
          >
            <p>
              Layout changed in another browser. Your unsaved change was not
              applied.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void reloadConflict()}>
                Load latest layout
              </Button>
              <Button variant="outline" onClick={() => void reapplyConflict()}>
                Reapply my change
              </Button>
            </div>
          </div>
        ) : null}
        {isLoading || personalLinksPending || linksPending ? (
          <p role="status">Loading workspace</p>
        ) : null}
        {isError || personalLinksError || linksError ? (
          <div role="alert" className="rounded border p-4">
            <p>
              {[
                isError && "managed apps",
                personalLinksError && "own links",
                linksError && "Atura links",
              ]
                .filter(Boolean)
                .join(", ")}{" "}
              could not be loaded. List incomplete.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void refetchApps();
                void refetchPersonalLinks();
                void refetchLinks();
              }}
            >
              Retry
            </Button>
          </div>
        ) : null}
        {!isLoading &&
        !personalLinksPending &&
        !linksPending &&
        !isError &&
        !personalLinksError &&
        !linksError ? (
          <LauncherView
            key={`${session.data?.user.id}:${session.data?.session.activeOrganizationId}`}
            apps={apps}
            personalLinks={personalLinks ?? []}
            externalLinks={externalLinks ?? []}
            preferences={preferences}
            layout={layout}
            onUpdate={updateLauncher}
            onOpenSetup={openSetup}
            onUseMcp={setMcpApp}
          />
        ) : null}
        {!isLoading &&
        !isError &&
        !isMemberRolePending &&
        userCanManageApps &&
        apps.length === 0 ? (
          <AppGallery
            onPickApp={setPickedApp}
            onBuild={() => setBuildOpen(true)}
          />
        ) : null}
      </div>
      <PWAInstallModal
        open={showPWAInstallModal}
        onClose={() => setShowPWAInstallModal(false)}
      />
      {pickedApp ? (
        <FeaturedAppDialog
          app={pickedApp}
          canRun={userCanManageApps}
          onClose={() => setPickedApp(null)}
        />
      ) : null}
      {buildOpen ? (
        <BuildYourOwnDialog onClose={() => setBuildOpen(false)} />
      ) : null}
      {setupApp ? (
        <AppSetupDialog
          name={setupApp.name}
          setup={setupApp.setup}
          canRun={
            userCanManageApps &&
            setupApp.organizationId ===
              session.data?.session.activeOrganizationId
          }
          onClose={closeSetup}
        />
      ) : null}
      {selectedMcpApp ? (
        <McpAppDialog
          name={selectedMcpApp.name}
          appId={selectedMcpApp.appId}
          onClose={() => setMcpApp(null)}
        />
      ) : null}
    </div>
  );
}
