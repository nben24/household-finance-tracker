"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, MAIN_NAV, type NavItem } from "./nav-items";

const MOBILE_NAV: NavItem[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/transactions", label: "Transactions", icon: "list" },
  { href: "/budget", label: "Budget", icon: "wallet" },
  { href: "/review", label: "Review", icon: "check" },
  { href: "/more", label: "More", icon: "more" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ reviewCount }: { reviewCount: number }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {MAIN_NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
              active ? "bg-accent-soft text-accent" : "text-muted hover:bg-bg hover:text-text"
            }`}
          >
            <Icon name={item.icon} />
            <span className="flex-1">{item.label}</span>
            {item.href === "/review" && reviewCount > 0 && (
              <span className="rounded-full bg-notice-soft px-2 py-0.5 text-xs text-notice tabular">
                {reviewCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileNav({ reviewCount }: { reviewCount: number }) {
  const pathname = usePathname();
  const mainPaths = MOBILE_NAV.map((item) => item.href);
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {MOBILE_NAV.map((item) => {
        // "More" is active for any page that has no tab of its own.
        const active =
          item.href === "/more"
            ? !mainPaths.some((href) => href !== "/more" && isActive(pathname, href))
            : isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`relative flex flex-col items-center gap-1 py-2 text-[11px] font-medium ${
              active ? "text-accent" : "text-muted"
            }`}
          >
            <Icon name={item.icon} className="h-6 w-6" />
            {item.label}
            {item.href === "/review" && reviewCount > 0 && (
              <span className="absolute right-[22%] top-1 rounded-full bg-notice-soft px-1.5 text-[10px] text-notice tabular">
                {reviewCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
