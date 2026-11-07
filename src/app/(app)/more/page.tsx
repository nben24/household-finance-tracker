import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { Icon, MAIN_NAV } from "@/components/nav-items";
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
      <Card>
        <ul className="divide-y divide-line">
          {MAIN_NAV.filter((item) => !TAB_PATHS.includes(item.href)).map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="flex items-center gap-3 py-3 text-sm font-medium">
                <Icon name={item.icon} className="h-5 w-5 text-muted" />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
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
