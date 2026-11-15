import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { Icon, NAV_GROUPS } from "@/components/nav-items";
import { Card, PageHeader } from "@/components/ui";
import { requireHousehold } from "@/lib/data";

export const metadata: Metadata = { title: "More" };

// Pages that don't have their own tab in the phone navigation.
const TAB_PATHS = ["/", "/transactions", "/budget", "/review"];

export default async function MorePage() {
  const session = await requireHousehold();
  return (
    <>
      <PageHeader title="More" subtitle={`Signed in as ${session.user.name}`} />
      <div className="flex flex-col gap-4">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => !TAB_PATHS.includes(item.href));
          if (items.length === 0) return null;
          return (
            <Card key={group.label} title={group.label}>
              <ul className="divide-y divide-line">
                {items.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="flex min-h-12 items-center gap-3 py-2 text-sm font-medium">
                      <Icon name={item.icon} className="h-5 w-5 text-muted" />
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
      {!session.isDemo && (
        <form action={signOut} className="mt-4">
          <button
            type="submit"
            className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm font-medium"
          >
            Sign out
          </button>
        </form>
      )}
    </>
  );
}
