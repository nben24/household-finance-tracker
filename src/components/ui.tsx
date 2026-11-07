import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </header>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-sm font-medium text-accent hover:underline">
      {children}
    </Link>
  );
}

/** Previous / next stepper used for months and weeks. */
export function Stepper({
  previousHref,
  nextHref,
  label,
}: {
  previousHref: string;
  nextHref: string | null;
  label: string;
}) {
  const button = "rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium";
  return (
    <div className="flex items-center gap-2">
      <Link href={previousHref} className={`${button} hover:bg-bg`} aria-label={`Before ${label}`}>
        ←
      </Link>
      {nextHref ? (
        <Link href={nextHref} className={`${button} hover:bg-bg`} aria-label={`After ${label}`}>
          →
        </Link>
      ) : (
        <span className={`${button} opacity-40`} aria-hidden="true">
          →
        </span>
      )}
    </div>
  );
}

/** Horizontal bars for a ranked list of amounts. */
export function BarList({
  items,
  empty,
}: {
  items: { key: string; label: string; value: string; fraction: number; href?: string; note?: string }[];
  empty: string;
}) {
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => {
        const label = item.href ? (
          <Link href={item.href} className="hover:underline">
            {item.label}
          </Link>
        ) : (
          item.label
        );
        return (
          <li key={item.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate">
                {label}
                {item.note && <span className="ml-2 text-xs text-muted">{item.note}</span>}
              </span>
              <span className="font-medium tabular">{item.value}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-bg">
              <div
                className="h-1.5 rounded-full bg-accent"
                style={{ width: `${Math.max(0, Math.min(1, item.fraction)) * 100}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ComingSoon({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <p className="text-sm font-medium">This page isn&apos;t ready yet.</p>
        <p className="mt-2 max-w-prose text-sm text-muted">{children}</p>
      </Card>
    </>
  );
}
