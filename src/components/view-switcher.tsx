import Link from "next/link";
import { viewParam } from "@/lib/finance/view-param";
import type { View } from "@/lib/finance/views";
import { queryString } from "@/lib/params";
import { segmentClass } from "./styles";

/**
 * Everyone · each person · Shared. Keeps the page's other settings in the
 * link. On a phone it scrolls sideways rather than wrapping, so long names
 * never push the page wider.
 */
export function ViewSwitcher({
  path,
  current,
  members,
  params = {},
  compact = false,
}: {
  path: string;
  current: View;
  members: { id: string; name: string }[];
  params?: Record<string, string | number | undefined>;
  /** no bottom margin (the page places it) */
  compact?: boolean;
}) {
  const views: { view: View; label: string }[] = [
    { view: { kind: "everyone" }, label: "Everyone" },
    ...members.map((member) => ({ view: { kind: "person" as const, personId: member.id }, label: member.name })),
    { view: { kind: "shared" }, label: "Shared" },
  ];
  const active = viewParam(current);
  return (
    <nav
      aria-label="Whose money"
      className={`${compact ? "" : "mb-5"} -mx-1 flex max-w-full overflow-x-auto px-1 sm:mx-0 sm:px-0`}
    >
      <div className="inline-flex shrink-0 rounded-xl border border-line bg-surface p-1">
        {views.map(({ view, label }) => {
          const value = viewParam(view);
          const selected = value === active;
          return (
            <Link
              key={value}
              href={`${path}${queryString({ ...params, view: value === "everyone" ? undefined : value })}`}
              aria-current={selected ? "page" : undefined}
              className={`${segmentClass(selected)} max-w-[10rem] whitespace-nowrap`}
            >
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
