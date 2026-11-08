// Shared by server pages and the client-side navigation.

export type IconName =
  | "home"
  | "list"
  | "check"
  | "wallet"
  | "repeat"
  | "trend"
  | "chart"
  | "upload"
  | "settings"
  | "more";

const ICON_PATHS: Record<IconName, string> = {
  home: "M3 11l9-8 9 8M5 10v10h14V10",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  check: "M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  wallet: "M3 7h18v12H3zM3 7l2-3h14l2 3M16 13h2",
  repeat: "M17 2l4 4-4 4M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 01-3 3H3",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  settings: "M4 6h10M18 6h2M4 12h2M10 12h10M4 18h10M18 18h2M16 4v4M8 10v4M16 16v4",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};

export function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 3 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

export const MAIN_NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "home" },
  { href: "/transactions", label: "Transactions", icon: "list" },
  { href: "/review", label: "Sunday Review", icon: "check" },
  { href: "/budget", label: "Budget", icon: "wallet" },
  { href: "/recurring", label: "Recurring", icon: "repeat" },
  { href: "/net-worth", label: "Net Worth", icon: "trend" },
  { href: "/charts", label: "Charts", icon: "chart" },
  { href: "/reports", label: "Reports", icon: "list" },
  { href: "/forecast", label: "Forecast", icon: "trend" },
  { href: "/import", label: "Import", icon: "upload" },
  { href: "/catch-up", label: "Catch-up", icon: "check" },
  { href: "/settings", label: "Settings", icon: "settings" },
];
