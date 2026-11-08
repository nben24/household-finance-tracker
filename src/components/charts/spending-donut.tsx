"use client";

import Link from "next/link";
import { useState } from "react";
import type { Slice } from "@/lib/finance/charts";
import { formatCentsRounded } from "@/lib/money";
import { Key, SERIES } from "./chart-kit";

const SIZE = 184;
const RADIUS = 78;
const THICKNESS = 26;

/** Path of a ring segment from one angle to another (radians, 0 = 12 o'clock). */
function arc(start: number, end: number): string {
  const c = SIZE / 2;
  const outer = RADIUS;
  const inner = RADIUS - THICKNESS;
  // rounded, so the server and the browser write exactly the same path
  const round = (n: number) => Math.round(n * 100) / 100;
  const point = (r: number, angle: number) => `${round(c + r * Math.sin(angle))} ${round(c - r * Math.cos(angle))}`;
  const large = end - start > Math.PI ? 1 : 0;
  return [
    `M ${point(outer, start)}`,
    `A ${outer} ${outer} 0 ${large} 1 ${point(outer, end)}`,
    `L ${point(inner, end)}`,
    `A ${inner} ${inner} 0 ${large} 0 ${point(inner, start)}`,
    "Z",
  ].join(" ");
}

/** Where the month's spending went: a ring of the named categories and Other, with every amount beside it. */
export function SpendingDonut({ slices, hrefFor }: { slices: Slice[]; hrefFor: Record<string, string> }) {
  const [active, setActive] = useState<string | null>(null);
  const total = slices.reduce((sum, slice) => sum + slice.cents, 0);
  const shown = slices.find((slice) => slice.id === active);

  const segments = slices.map((slice, index) => {
    const start = slices.slice(0, index).reduce((sum, earlier) => sum + earlier.share, 0) * Math.PI * 2;
    const end = start + slice.share * Math.PI * 2;
    // a single slice would be a full circle, which an arc can't draw
    return { slice, path: arc(start, Math.min(end, start + Math.PI * 2 - 0.0001)) };
  });

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`Spending by category, ${formatCentsRounded(total)} in all`}
        className="shrink-0"
      >
        {segments.map(({ slice, path }) => (
          <path
            key={slice.id}
            d={path}
            fill={SERIES[slice.slot]}
            stroke="var(--surface)"
            strokeWidth={2}
            opacity={active && active !== slice.id ? 0.35 : 1}
            onPointerEnter={() => setActive(slice.id)}
            onPointerLeave={() => setActive(null)}
          />
        ))}
        <text x={SIZE / 2} y={SIZE / 2 - 4} textAnchor="middle" className="fill-text text-lg font-semibold">
          {formatCentsRounded(shown ? shown.cents : total)}
        </text>
        <text x={SIZE / 2} y={SIZE / 2 + 15} textAnchor="middle" className="fill-muted text-xs">
          {shown ? `${shown.name} · ${Math.round(shown.share * 100)}%` : "spent"}
        </text>
      </svg>
      <ul className="w-full min-w-0 flex-1 divide-y divide-line text-sm">
        {slices.map((slice) => (
          <li key={slice.id}>
            <Link
              href={hrefFor[slice.id] ?? "#"}
              onPointerEnter={() => setActive(slice.id)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(slice.id)}
              onBlur={() => setActive(null)}
              className={`flex items-center gap-2 py-1.5 hover:text-accent ${active === slice.id ? "text-accent" : ""}`}
            >
              <Key color={SERIES[slice.slot]} />
              <span className="min-w-0 flex-1 truncate">{slice.name}</span>
              <span className="tabular">{formatCentsRounded(slice.cents)}</span>
              <span className="w-10 text-right text-xs text-muted tabular">
                {slice.share < 0.005 ? "<1%" : `${Math.round(slice.share * 100)}%`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
