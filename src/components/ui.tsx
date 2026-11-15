import Link from "next/link";
import type { ReactNode } from "react";
import { segmentClass, segmentedClass } from "./styles";

// Type scale used across the app:
//   page title 24–28px · section heading 16px · body 14–16px · metadata 12–13px

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
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
      <div className="min-w-0">
        <h1 className="break-anywhere text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">{title}</h1>
        {subtitle && <p className="break-anywhere mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
  headingLevel = 2,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          {title && <Heading className="text-base font-semibold">{title}</Heading>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * A labelled number. `size` sets its emphasis: "primary" for the one number a
 * page is about, "secondary" for its companions, "supporting" for context.
 */
export function Metric({
  label,
  value,
  hint,
  size = "secondary",
  tone,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  size?: "primary" | "secondary" | "supporting";
  tone?: "notice";
}) {
  const valueClass =
    size === "primary" ? "text-3xl sm:text-4xl" : size === "secondary" ? "text-2xl" : "text-lg";
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className={`mt-0.5 font-semibold tabular break-anywhere ${valueClass} ${tone === "notice" ? "text-notice" : ""}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-[13px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}

/** A Metric in its own bordered tile, for grids of figures. */
export function MetricTile(props: Parameters<typeof Metric>[0]) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <Metric {...props} />
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

/**
 * Previous / next stepper used for months and weeks. When `showLabel` is set,
 * the period it is on sits between the arrows, so the current period is
 * always visible next to the controls that change it.
 */
export function Stepper({
  previousHref,
  nextHref,
  label,
  showLabel = false,
}: {
  previousHref: string;
  nextHref: string | null;
  label: string;
  showLabel?: boolean;
}) {
  const button =
    "inline-flex h-10 min-w-10 items-center justify-center rounded-lg border border-line bg-surface px-3 text-sm font-medium";
  return (
    <div className="flex items-center gap-2">
      <Link href={previousHref} className={`${button} hover:bg-bg`} aria-label={`Before ${label}`}>
        <span aria-hidden="true">←</span>
      </Link>
      {showLabel && (
        <span className="min-w-0 px-1 text-center text-sm font-medium" aria-live="polite">
          {label}
        </span>
      )}
      {nextHref ? (
        <Link href={nextHref} className={`${button} hover:bg-bg`} aria-label={`After ${label}`}>
          <span aria-hidden="true">→</span>
        </Link>
      ) : (
        <span className={`${button} opacity-40`} aria-label={`Nothing after ${label} yet`} role="img">
          <span aria-hidden="true">→</span>
        </span>
      )}
    </div>
  );
}

/** A segmented choice made of links (Month / Week, This month / Next month…). */
export function SegmentedLinks({
  label,
  options,
}: {
  label: string;
  options: { href: string; label: string; selected: boolean }[];
}) {
  return (
    <nav aria-label={label} className={segmentedClass}>
      {options.map((option) => (
        <Link
          key={option.href + option.label}
          href={option.href}
          aria-current={option.selected ? "page" : undefined}
          className={segmentClass(option.selected)}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  );
}

/** Expandable detail, closed by default, for secondary explanations. */
export function Disclosure({
  summary,
  children,
  open = false,
  className = "",
}: {
  summary: ReactNode;
  children: ReactNode;
  open?: boolean;
  className?: string;
}) {
  return (
    <details open={open} className={`group ${className}`}>
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-accent [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
          ›
        </span>
        {summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

/** A short status message in a bordered box (not an error). */
export function Callout({
  children,
  tone = "plain",
  className = "",
}: {
  children: ReactNode;
  tone?: "plain" | "notice" | "accent";
  className?: string;
}) {
  const colors =
    tone === "notice"
      ? "border-transparent bg-notice-soft text-notice"
      : tone === "accent"
        ? "border-transparent bg-accent-soft text-accent"
        : "border-line bg-surface";
  return <div className={`rounded-xl border px-4 py-3 text-sm ${colors} ${className}`}>{children}</div>;
}

export interface BarItem {
  key: string;
  label: string;
  value: string;
  fraction: number;
  href?: string;
  note?: string;
  /** "over" draws the bar in amber with a striped end; "fixed" in a muted tone */
  tone?: "normal" | "over" | "fixed";
  /** read out to screen readers with the bar, e.g. "$202 over budget" */
  status?: string;
}

/** Horizontal bars for a ranked list of amounts. */
export function BarList({ items, empty }: { items: BarItem[]; empty: string }) {
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
        const tone = item.tone ?? "normal";
        const fill =
          tone === "over" ? "bg-notice" : tone === "fixed" ? "bg-muted" : "bg-accent";
        return (
          <li key={item.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 break-anywhere">
                {label}
                {item.note && (
                  <span className={`ml-2 text-xs ${tone === "over" ? "font-medium text-notice" : "text-muted"}`}>
                    {item.note}
                  </span>
                )}
                {item.status && <span className="sr-only">, {item.status}</span>}
              </span>
              <span className="shrink-0 font-medium tabular">{item.value}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-bg" aria-hidden="true">
              <div
                className={`h-1.5 rounded-full ${fill}`}
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
