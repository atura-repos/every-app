import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/client/hooks/useSession";
import { listExternalLinks } from "@/serverFunctions/externalLinks";

/** ACL-filtered links must only be shown after this viewer's live validation. */
export function useExternalLinks() {
  const session = useSession();
  const orgId = session.data?.session.activeOrganizationId;
  const userId = session.data?.user.id;
  const validated =
    session.isFetchedAfterMount && !session.isFetching && !session.error;
  const query = useQuery({
    queryKey: ["external-links", orgId, userId],
    enabled: Boolean(orgId && userId && validated),
    meta: { persist: false },
    queryFn: () => listExternalLinks(),
  });
  // A cached result may survive a revocation or a failed revalidation in
  // memory. Never return that result while checking or after a failed check.
  const data =
    validated &&
    query.isFetchedAfterMount &&
    !query.isFetching &&
    !query.isError
      ? query.data
      : undefined;
  return {
    ...query,
    data,
    isPending: query.isPending || (!query.isError && !data),
  };
}
