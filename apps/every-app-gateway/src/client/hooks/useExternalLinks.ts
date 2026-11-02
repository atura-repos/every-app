import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/client/hooks/useSession";
import { listExternalLinks } from "@/serverFunctions/externalLinks";

/** Key by active organization: never display the previous workspace's links. */
export function useExternalLinks() {
  const { data: session } = useSession();
  const orgId = session?.session.activeOrganizationId;
  return useQuery({
    queryKey: ["external-links", orgId],
    enabled: Boolean(orgId),
    queryFn: () => listExternalLinks(),
  });
}
