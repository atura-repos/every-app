import { useQuery } from "@tanstack/react-query";
import { useSession } from "./useSession";
import { listPersonalLinks } from "@/serverFunctions/personalPortal";

/** Personal URLs are never persisted or shown without fresh session and ACL checks. */
export function usePersonalLinks() {
  const session = useSession();
  const userId = session.data?.user.id;
  const orgId = session.data?.session.activeOrganizationId;
  const validated =
    session.isFetchedAfterMount && !session.isFetching && !session.error;
  const query = useQuery({
    queryKey: ["personal-links", userId, orgId],
    enabled: Boolean(userId && orgId && validated),
    meta: { persist: false },
    queryFn: () => listPersonalLinks(),
  });
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
