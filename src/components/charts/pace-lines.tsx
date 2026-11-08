"use client";

import { useState } from "react";
import { formatDay } from "@/lib/dates";
import type { Pace } from "@/lib/finance/charts";
import { formatCentsRounded } from "@/lib/money";
import { axisMoney, Legend, niceTicks, TableView, Tooltip, TooltipRow, useWidth } from "./chart-kit";

const HEIGHT = 220;
const PAD = { top: 12, right: 16, bottom: 24, left: 52 };
const THIS_MONTH = "var(--series-1)";
const TYPICAL = "var(--series-other)";

/** Spending so far this month, day by day, against a typical month. */
export function PaceLines({ pace }: { pace: Pace }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const width = measured ?? 0;
  const [day, setDay] = useState<number | null>(null);
  const days = pace.daysInMonth;
  const max = Math.max(...pace.soFar, ...(pace.typical ?? []), 0);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (days > 1 ? (index / (days - 1)) * plotWidth : 0);
  const y = (cents: number) => PAD.top + plotHeight - (cents / top) * plotHeight;
  const line = (values: number[]) =>
    values.map((value, index) => `${index ? "L" : "M"}${x(index)} ${y(value)}`).join(" ");
  const date = (index: number) => formatDay(`${pace.month}-${String(index + 1).padStart(2, "0")}`);
  const last = pace.soFar.length - 1;

  const pick = (clientX: number, element: SVGSVGElement) => {
    const left = element.getBoundingClientRect().left;
    const index = Math.round(((clientX - left - PAD.left) / plotWidth) * (days - 1));
    setDay(Math.min(days - 1, Math.max(0, index)));
  };

  return (
    <div>
      <Legend
        items={[
          { label: "This month", color: THIS_MONTH, shape: "line" },
          ...(pace.typical
            ? [{ label: `Typical month (last ${pace.historyMonths})`, color: TYPICAL, shape: "line" as const }]
            : []),
        ]}
      />
      <div ref={ref} className="relative" style={{ minHeight: HEIGHT }}>
        {measured !== null && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label="Spending so far this month compared with a typical month"
            onPointerMove={(event) => pick(event.clientX, event.currentTarget)}
            onPointerLeave={() => setDay(null)}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" />
                <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" className="fill-muted text-[11px] tabular">
                  {axisMoney(tick)}
                </text>
              </g>
            ))}
            {[0, Math.floor((days - 1) / 2), days - 1].map((index) => (
              <text
                key={index}
                x={x(index)}
                y={HEIGHT - 6}
                textAnchor={index === 0 ? "start" : index === days - 1 ? "end" : "middle"}
                className="fill-muted text-[11px]"
              >
                {date(index)}
              </text>
            ))}
            {pace.typical && (
              <path
                d={line(pace.typical)}
                fill="none"
                stroke={TYPICAL}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {last >= 0 && (
              <>
                <path
                  d={line(pace.soFar)}
                  fill="none"
                  stroke={THIS_MONTH}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <circle
                  cx={x(last)}
                  cy={y(pace.soFar[last])}
                  r={4.5}
                  fill={THIS_MONTH}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
                <text
                  x={Math.min(x(last) + 8, width - PAD.right)}
                  y={y(pace.soFar[last]) - 8}
                  textAnchor={x(last) + 70 > width ? "end" : "start"}
                  className="fill-text text-xs font-semibold tabular"
                >
                  {formatCentsRounded(pace.soFar[last])}
                </text>
              </>
            )}
            {day !== null && (
              <line
                x1={x(day)}
                x2={x(day)}
                y1={PAD.top}
                y2={PAD.top + plotHeight}
                stroke="var(--muted)"
                strokeWidth={1}
              />
            )}
          </svg>
        )}
        {day !== null && (
          <Tooltip x={x(day)} y={PAD.top} width={width}>
            <p className="mb-1 font-semibold">By {date(day)}</p>
            <TooltipRow
              color={THIS_MONTH}
              shape="line"
              label="This month"
              value={day <= last ? formatCentsRounded(pace.soFar[day]) : "—"}
            />
            {pace.typical && (
              <TooltipRow color={TYPICAL} shape="line" label="Typical" value={formatCentsRounded(pace.typical[day])} />
            )}
          </Tooltip>
        )}
      </div>
      <TableView
        head={["Day", "This month", ...(pace.typical ? ["Typical month"] : [])]}
        rows={Array.from({ length: days }, (_, index) => index)
          .filter((index) => index % 7 === 6 || index === last || index === days - 1)
          .map((index) => [
            date(index),
            index <= last ? formatCentsRounded(pace.soFar[index]) : "—",
            ...(pace.typical ? [formatCentsRounded(pace.typical[index])] : []),
          ])}
      />
    </div>
  );
}
