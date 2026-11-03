import { Link } from "@tanstack/react-router";
import { PersonalLinkList, type PersonalLink } from "./PersonalLinkList";

export function LauncherPersonalLinks({ links }: { links: PersonalLink[] }) {
  if (!links.length) return null;
  return (
    <div className="space-y-2">
      <PersonalLinkList links={links} />
      <Link
        to="/settings"
        className="text-sm text-muted-foreground hover:underline"
      >
        Manage personal links in settings
      </Link>
    </div>
  );
}
