"use client";

import { useState } from "react";
import type { MonthFlow } from "@/lib/finance/charts";
import { formatCentsRounded } from "@/lib/money";
import { axisMoney, Legend, niceTicks, TableView, Tooltip, TooltipRow, useWidth } from "./chart-kit";

const HEIGHT = 220;
const PAD = { top: 8, right: 8, bottom: 24, left: 52 };
const SERIES = [
  { key: "incomeCents", label: "Money in", color: "var(--series-1)" },
  { key: "spendingCents", label: "Spending", color: "var(--series-2)" },
  { key: "setAsideCents", label: "Saved & invested", color: "var(--series-3)" },
] as const;

/** Money in, spending, and saved & invested, side by side for each month. */
export function FlowColumns({ flow, incomeLabel = "Money in" }: { flow: MonthFlow[]; incomeLabel?: string }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const width = measured ?? 0;
  const [active, setActive] = useState<number | null>(null);
  const series = SERIES.map((s) => (s.key === "incomeCents" ? { ...s, label: incomeLabel } : s));

  const max = Math.max(...flow.flatMap((month) => series.map((s) => month[s.key])), 0);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const band = plotWidth / Math.max(flow.length, 1);
  const bar = Math.min(16, Math.max(4, (band - 10) / series.length - 2));
  const y = (cents: number) => PAD.top + plotHeight - (Math.max(cents, 0) / top) * plotHeight;
  const every = Math.ceil(flow.length / Math.max(1, Math.floor(plotWidth / 56)));

  return (
    <div>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
      <div ref={ref} className="relative" style={{ minHeight: HEIGHT }} onPointerLeave={() => setActive(null)}>
        {measured !== null && (
          <svg width={width} height={HEIGHT} role="img" aria-label="Money in and out by month">
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" />
                <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" className="fill-muted text-[11px] tabular">
                  {axisMoney(tick)}
                </text>
              </g>
            ))}
            {flow.map((month, index) => {
              const groupLeft = PAD.left + band * index + (band - (bar + 2) * series.length + 2) / 2;
              return (
                <g key={month.month} opacity={active !== null && active !== index ? 0.45 : 1}>
                  {series.map((s, si) => {
                    const value = Math.max(month[s.key], 0);
                    const height = y(0) - y(value);
                    const x = groupLeft + si * (bar + 2);
                    const r = Math.min(4, bar / 2, height);
                    // rounded at the top, square at the baseline
                    return height > 0 ? (
                      <path
                        key={s.key}
                        fill={s.color}
                        d={`M${x} ${y(0)} V${y(value) + r} Q${x} ${y(value)} ${x + r} ${y(value)} H${x + bar - r} Q${x + bar} ${y(value)} ${x + bar} ${y(value) + r} V${y(0)} Z`}
                      />
                    ) : null;
                  })}
                  {index % every === 0 && (
                    <text
                      x={PAD.left + band * index + band / 2}
                      y={HEIGHT - 6}
                      textAnchor="middle"
                      className="fill-muted text-[11px]"
                    >
                      {month.label.slice(0, 3)}
                    </text>
                  )}
                  <rect
                    x={PAD.left + band * index}
                    y={PAD.top}
                    width={band}
                    height={plotHeight}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${month.label}: ${series.map((s) => `${s.label} ${formatCentsRounded(month[s.key])}`).join(", ")}`}
                    onPointerEnter={() => setActive(index)}
                    onFocus={() => setActive(index)}
                    onBlur={() => setActive(null)}
                  />
                </g>
              );
            })}
          </svg>
        )}
        {active !== null && (
          <Tooltip x={PAD.left + band * active + band / 2} y={PAD.top} width={width}>
            <p className="mb-1 font-semibold">{flow[active].label}</p>
            {series.map((s) => (
              <TooltipRow key={s.key} color={s.color} label={s.label} value={formatCentsRounded(flow[active][s.key])} />
            ))}
            <TooltipRow label="Left over" value={formatCentsRounded(flow[active].leftOverCents)} />
          </Tooltip>
        )}
      </div>
      <TableView
        head={["Month", ...series.map((s) => s.label), "Left over"]}
        rows={flow.map((month) => [
          month.label,
          ...series.map((s) => formatCentsRounded(month[s.key])),
          formatCentsRounded(month.leftOverCents),
        ])}
      />
    </div>
  );
}
