import Link from "next/link";
import { viewParam } from "@/lib/finance/view-param";
import type { View } from "@/lib/finance/views";
import { queryString } from "@/lib/params";

/** Everyone · each person · Shared. Keeps the page's other settings in the link. */
export function ViewSwitcher({
  path,
  current,
  members,
  params = {},
}: {
  path: string;
  current: View;
  members: { id: string; name: string }[];
  params?: Record<string, string | number | undefined>;
}) {
  const views: { view: View; label: string }[] = [
    { view: { kind: "everyone" }, label: "Everyone" },
    ...members.map((member) => ({ view: { kind: "person" as const, personId: member.id }, label: member.name })),
    { view: { kind: "shared" }, label: "Shared" },
  ];
  const active = viewParam(current);
  return (
    <nav aria-label="Whose money" className="mb-5 flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1 sm:inline-flex">
      {views.map(({ view, label }) => {
        const value = viewParam(view);
        const selected = value === active;
        return (
          <Link
            key={value}
            href={`${path}${queryString({ ...params, view: value === "everyone" ? undefined : value })}`}
            aria-current={selected ? "page" : undefined}
            className={`flex-1 rounded-lg px-4 py-1.5 text-center text-sm font-medium sm:flex-none ${
              selected ? "bg-accent-soft text-accent" : "text-muted hover:text-text"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
