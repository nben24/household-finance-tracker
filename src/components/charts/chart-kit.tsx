"use client";

// Small pieces every chart shares: its own width, clean axis numbers, the
// hover tooltip and the "show as a table" view.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatCentsRounded } from "@/lib/money";

/**
 * The chart's rendered width, so text and marks stay their real size on any
 * screen. Null until measured: charts draw nothing rather than guess.
 */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Round axis steps (0, 500, 1,000 …) covering 0 → max. */
export function niceTicks(maxCents: number, count = 4): number[] {
  const max = Math.max(maxCents, 100);
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= rough) ?? rough;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 0.001; value += step) ticks.push(Math.round(value));
  if (ticks[ticks.length - 1] < max) ticks.push(Math.round(ticks[ticks.length - 1] + step));
  return ticks;
}

/** "$1,200" under 10K, "$12K" from there. */
export function axisMoney(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 10000) return `$${Math.round(dollars / 1000)}K`;
  return formatCentsRounded(cents);
}

export const SERIES = [
  "var(--series-other)",
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
];

/** A key mark for a legend or tooltip row: a box for bars and slices, a short line for lines. */
export function Key({ color, shape = "box" }: { color: string; shape?: "box" | "line" }) {
  return shape === "line" ? (
    <span aria-hidden="true" className="inline-block h-0.5 w-3 shrink-0 rounded-full" style={{ background: color }} />
  ) : (
    <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />
  );
}

export function Legend({ items }: { items: { label: string; color: string; shape?: "box" | "line" }[] }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <Key color={item.color} shape={item.shape} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** A small card that follows the pointer; values lead, names follow. */
export function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x + 12, 0), Math.max(0, width - 190));
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 w-44 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
      style={{ left, top: Math.max(0, y - 10) }}
    >
      {children}
    </div>
  );
}

export function TooltipRow({
  color,
  label,
  value,
  shape,
}: {
  color?: string;
  label: string;
  value: string;
  shape?: "box" | "line";
}) {
  return (
    <p className="flex items-center justify-between gap-2 py-0.5">
      <span className="flex min-w-0 items-center gap-1.5 text-muted">
        {color && <Key color={color} shape={shape} />}
        <span className="truncate">{label}</span>
      </span>
      <span className="font-semibold tabular text-text">{value}</span>
    </p>
  );
}

/** Every value of a chart, readable without hovering. */
export function TableView({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer font-medium text-muted hover:text-text">Show as a table</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-muted">
              {head.map((cell, index) => (
                <th key={cell} className={`pb-1 font-medium ${index > 0 ? "text-right" : ""}`}>
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, index) => (
                  <td key={index} className={`py-1 ${index > 0 ? "text-right tabular" : ""}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
