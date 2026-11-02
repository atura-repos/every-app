import type { externalLinks } from "@/db/schema";
import { ArrowUpRight } from "lucide-react";

type ExternalLink = typeof externalLinks.$inferSelect;
/** These are bookmarks, not deployed apps; destination auth is independent. */
export function ExternalLinkList({ links }: { links: ExternalLink[] }) {
  if (!links.length) return null;
  return (
    <section aria-label="External links" className="space-y-3 pt-4">
      <h2 className="text-lg font-semibold">External links</h2>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {links.map((link) => (
          <li key={link.id}>
            <a
              className="flex items-center gap-3 rounded-xl border bg-card p-5 hover:bg-accent"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="min-w-0 flex-1">
                <strong className="block truncate">{link.name}</strong>
                <span className="text-xs text-muted-foreground">
                  External site · opens in a new tab
                </span>
              </span>
              <ArrowUpRight className="size-4 shrink-0" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
