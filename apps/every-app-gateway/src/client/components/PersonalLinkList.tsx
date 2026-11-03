import { ArrowUpRight } from "lucide-react";
export type PersonalLink = { id: string; name: string; url: string };
export function PersonalLinkList({
  links,
  onEdit,
  onDelete,
}: {
  links: PersonalLink[];
  onEdit?: (link: PersonalLink) => void;
  onDelete?: (link: PersonalLink) => void;
}) {
  if (!links.length) return null;
  return (
    <section aria-label="Personal links" className="space-y-3 pt-4">
      <h2 className="text-lg font-semibold">Personal links</h2>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {links.map((link) => (
          <li key={link.id} className="rounded-xl border bg-card p-5">
            <a
              className="flex items-center gap-3 hover:underline"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <strong className="min-w-0 flex-1 truncate">{link.name}</strong>
              <ArrowUpRight className="size-4" aria-hidden />
            </a>
            <p className="text-xs text-muted-foreground">
              Personal external site · opens in a new tab; destination access is
              separate
            </p>
            {onEdit && onDelete ? (
              <div className="mt-2 flex gap-3">
                <button
                  type="button"
                  className="text-sm underline"
                  onClick={() => onEdit(link)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="text-sm underline"
                  onClick={() => onDelete(link)}
                >
                  Delete
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
