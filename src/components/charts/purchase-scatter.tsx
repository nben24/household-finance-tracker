"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDay } from "@/lib/dates";
import { dayIndex, type Purchase } from "@/lib/finance/charts";
import { formatCentsRounded } from "@/lib/money";
import { axisMoney, niceTicks, TableView, Tooltip, TooltipRow, useWidth } from "./chart-kit";

const HEIGHT = 220;
const PAD = { top: 16, right: 16, bottom: 24, left: 52 };
const DOT = "var(--series-1)";

/** Every purchase this month by day and size, so the big ones stand out. Tap one to open it. */
export function PurchaseScatter({
  purchases,
  month,
  daysInMonth,
}: {
  purchases: Purchase[];
  month: string;
  daysInMonth: number;
}) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const width = measured ?? 0;
  const [active, setActive] = useState<string | null>(null);
  const router = useRouter();
  const ticks = niceTicks(Math.max(...purchases.map((p) => p.cents), 0));
  const top = ticks[ticks.length - 1];
  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (date: string) =>
    PAD.left + (daysInMonth > 1 ? (dayIndex(date, month) / (daysInMonth - 1)) * plotWidth : 0);
  const y = (cents: number) => PAD.top + plotHeight - (cents / top) * plotHeight;
  const day = (n: number) => formatDay(`${month}-${String(n).padStart(2, "0")}`);
  const shown = purchases.find((p) => p.id === active);
  const biggest = purchases[0];

  return (
    <div>
      <div ref={ref} className="relative" style={{ minHeight: HEIGHT }}>
        {measured !== null && (
          <svg width={width} height={HEIGHT} role="img" aria-label="Purchases this month by date and amount">
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" />
                <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" className="fill-muted text-[11px] tabular">
                  {axisMoney(tick)}
                </text>
              </g>
            ))}
            {[1, Math.ceil(daysInMonth / 2), daysInMonth].map((n, index) => (
              <text
                key={n}
                x={PAD.left + ((n - 1) / (daysInMonth - 1)) * plotWidth}
                y={HEIGHT - 6}
                textAnchor={(["start", "middle", "end"] as const)[index]}
                className="fill-muted text-[11px]"
              >
                {day(n)}
              </text>
            ))}
            {/* smallest last, so a big dot never hides a small one */}
            {[...purchases].reverse().map((purchase) => (
              <g
                key={purchase.id}
                className="cursor-pointer"
                tabIndex={0}
                role="link"
                aria-label={`${purchase.merchant}, ${formatCentsRounded(purchase.cents)}, ${formatDay(purchase.date)}`}
                onPointerEnter={() => setActive(purchase.id)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(purchase.id)}
                onBlur={() => setActive(null)}
                onClick={() => router.push(`/transactions/${purchase.id}`)}
                onKeyDown={(event) => event.key === "Enter" && router.push(`/transactions/${purchase.id}`)}
              >
                <circle cx={x(purchase.date)} cy={y(purchase.cents)} r={12} fill="transparent" />
                <circle
                  cx={x(purchase.date)}
                  cy={y(purchase.cents)}
                  r={active === purchase.id ? 6 : 4.5}
                  fill={DOT}
                  fillOpacity={active && active !== purchase.id ? 0.35 : 0.85}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              </g>
            ))}
            {biggest && !active && (
              <text
                x={x(biggest.date) + (x(biggest.date) > width - 140 ? -10 : 10)}
                y={y(biggest.cents) + 4}
                textAnchor={x(biggest.date) > width - 140 ? "end" : "start"}
                className="pointer-events-none fill-text text-xs font-semibold"
              >
                {biggest.merchant} · {formatCentsRounded(biggest.cents)}
              </text>
            )}
          </svg>
        )}
        {shown && (
          <Tooltip x={x(shown.date)} y={y(shown.cents)} width={width}>
            <p className="text-sm font-semibold tabular">{formatCentsRounded(shown.cents)}</p>
            <TooltipRow label={shown.merchant} value={formatDay(shown.date)} />
          </Tooltip>
        )}
      </div>
      <TableView
        head={["Purchase", "Date", "Amount"]}
        rows={purchases.slice(0, 15).map((p) => [p.merchant, formatDay(p.date), formatCentsRounded(p.cents)])}
      />
    </div>
  );
}
