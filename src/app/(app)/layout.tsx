import type { ReactNode } from "react";
import { signOut } from "@/app/auth/actions";
import { MobileNav, SidebarNav } from "@/components/nav";
import { getDataSource, requireHousehold, reviewQueueFilter } from "@/lib/data";

// Everything inside the app is per-person and must never be prerendered or cached.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireHousehold();
  const review = await getDataSource().listTransactions(
    session.household.id,
    reviewQueueFilter(session.household),
    { limit: 1, offset: 0 },
  );

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface p-4 md:flex">
        <div className="px-3 pb-5 pt-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">Household Finance</p>
          <p className="mt-1 truncate text-sm font-medium">{session.household.name}</p>
        </div>
        <SidebarNav reviewCount={review.total} />
        <div className="mt-auto border-t border-line px-3 pt-4 text-sm">
          <p className="truncate font-medium">{session.user.name}</p>
          {!session.isDemo && (
            <form action={signOut}>
              <button type="submit" className="mt-1 text-muted hover:text-text">
                Sign out
              </button>
            </form>
          )}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {session.isDemo && (
          <p className="bg-notice-soft px-4 py-2 text-center text-xs font-medium text-notice">
            Demo mode — every number here is made-up sample data.
          </p>
        )}
        <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 sm:px-6 md:pb-10 md:pt-8">{children}</main>
      </div>

      <MobileNav reviewCount={review.total} />
    </div>
  );
}
