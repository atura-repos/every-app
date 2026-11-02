import { useQuery } from "@tanstack/react-query";
import { useSession } from "./useSession";
import { listPersonalLinks } from "@/serverFunctions/personalPortal";
export function usePersonalLinks() {
  const { data: session } = useSession();
  return useQuery({
    queryKey: [
      "personal-links",
      session?.user.id,
      session?.session.activeOrganizationId,
    ],
    enabled: Boolean(session?.user.id && session.session.activeOrganizationId),
    queryFn: () => listPersonalLinks(),
  });
}
