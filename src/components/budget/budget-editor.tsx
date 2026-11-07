"use client";

import { useState } from "react";
import {
  addBudgetLine,
  addSuggestedBudgets,
  changeBudgetLine,
  removeBudgetLine,
} from "@/app/(app)/budget/actions";
import type { CategoryGroup } from "@/components/review/review-card";
import {
  Feedback,
  inputClass,
  primaryButton,
  smallButton,
  useSettingsAction,
} from "@/components/settings/use-settings-action";
import { BUDGET_KINDS, type BudgetKind } from "@/lib/db/types";
import { BUDGET_KIND_HINTS, BUDGET_KIND_LABELS } from "@/lib/labels";
import { formatCents, formatCentsRounded } from "@/lib/money";

export interface BudgetRowView {
  id: string;
  label: string;
  /** who the line belongs to, shown in the Everyone view */
  owner: string | null;
  kind: BudgetKind;
  amount: number;
  budgetCents: number;
  spentCents: number;
  remainingCents: number;
  fund?: { savedCents: number; spentCents: number; availableCents: number };
}

function ProgressBar({ spent, budget }: { spent: number; budget: number }) {
  const over = budget > 0 ? spent > budget : spent > 0;
  const fraction = budget > 0 ? Math.min(1, Math.max(0, spent / budget)) : spent > 0 ? 1 : 0;
  return (
    <div className="mt-2 h-2 rounded-full bg-bg" aria-hidden="true">
      <div className={`h-2 rounded-full ${over ? "bg-notice" : "bg-accent"}`} style={{ width: `${fraction * 100}%` }} />
    </div>
  );
}

function BudgetRow({
  row,
  month,
  readOnly,
}: {
  row: BudgetRowView;
  month: string;
  readOnly: boolean;
}) {
  const { pending, error, message, run } = useSettingsAction();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(row.amount));
  const [kind, setKind] = useState<BudgetKind>(row.kind);
  const over = row.remainingCents < 0;

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 text-sm font-medium">
          {row.label}
          {row.owner && <span className="ml-2 rounded-full bg-bg px-2 py-0.5 text-xs font-normal text-muted">{row.owner}</span>}
        </p>
        <p className="text-sm tabular">
          <span className="font-medium">{formatCents(row.spentCents)}</span>
          <span className="text-muted"> of {formatCentsRounded(row.budgetCents)}</span>
        </p>
      </div>
      <ProgressBar spent={row.spentCents} budget={row.budgetCents} />
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        {row.fund ? (
          <span className={row.fund.availableCents < 0 ? "text-notice" : "text-muted"}>
            Set aside {formatCentsRounded(row.fund.savedCents)} · spent {formatCentsRounded(row.fund.spentCents)} ·{" "}
            <span className="font-medium">
              {row.fund.availableCents < 0
                ? `${formatCentsRounded(-row.fund.availableCents)} more than set aside`
                : `${formatCentsRounded(row.fund.availableCents)} available`}
            </span>
          </span>
        ) : (
          <span className={over ? "font-medium text-notice" : "text-muted"}>
            {over ? `${formatCents(-row.remainingCents)} over` : `${formatCents(row.remainingCents)} left`}
          </span>
        )}
        {!readOnly && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="font-medium text-accent hover:underline">
            Change
          </button>
        )}
      </div>
      {editing && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run(() => changeBudgetLine({ id: row.id, month, amount, kind }), () => setEditing(false));
          }}
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          <label className="flex items-center gap-1 text-sm">
            $
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              aria-label="Monthly amount"
              className={`${inputClass} w-28 py-1`}
            />
          </label>
          <select value={kind} onChange={(event) => setKind(event.target.value as BudgetKind)} aria-label="Kind" className={`${inputClass} py-1`}>
            {BUDGET_KINDS.map((option) => (
              <option key={option} value={option}>
                {BUDGET_KIND_LABELS[option]}
              </option>
            ))}
          </select>
          <button type="submit" disabled={pending} className={smallButton}>
            Save
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => removeBudgetLine({ id: row.id, month }))}
            className={smallButton}
          >
            Remove
          </button>
          <button type="button" onClick={() => setEditing(false)} className={smallButton}>
            Cancel
          </button>
          <span className="basis-full text-xs text-muted">Changes apply from this month on; earlier months keep their budget.</span>
        </form>
      )}
      <Feedback error={error} message={message} />
    </li>
  );
}

export function BudgetGroups({
  groups,
  month,
  readOnly,
}: {
  groups: { kind: BudgetKind; rows: BudgetRowView[] }[];
  month: string;
  readOnly: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.kind} className="rounded-xl border border-line bg-surface p-4 sm:p-5">
          <h2 className="text-sm font-semibold">{BUDGET_KIND_LABELS[group.kind]}</h2>
          <p className="text-xs text-muted">{BUDGET_KIND_HINTS[group.kind]}</p>
          <ul className="mt-1 divide-y divide-line">
            {group.rows.map((row) => (
              <BudgetRow key={row.id} row={row} month={month} readOnly={readOnly} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function AddBudget({
  view,
  month,
  groups,
  averages,
  kinds,
  averageMonths,
  scopeHint,
}: {
  view: string;
  month: string;
  groups: CategoryGroup[];
  /** average monthly spending by category or subcategory id, in cents */
  averages: Record<string, number>;
  /** suggested kind by category or subcategory id */
  kinds: Record<string, BudgetKind>;
  averageMonths: number;
  scopeHint: string;
}) {
  const { pending, error, message, run } = useSettingsAction();
  const [choice, setChoice] = useState("");
  const [kind, setKind] = useState<BudgetKind>("variable");
  const [amount, setAmount] = useState("");

  const [type, id] = choice.split(":");
  const categoryId = type === "cat" ? id : groups.find((group) => group.children.some((child) => child.id === id))?.id;
  const average = id ? averages[id] : undefined;

  function choose(value: string) {
    setChoice(value);
    const chosenId = value.split(":")[1];
    if (chosenId) {
      setKind(kinds[chosenId] ?? "variable");
      const suggestion = averages[chosenId];
      setAmount(suggestion ? String(Math.ceil(suggestion / 100)) : "");
    }
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Add a budget</h2>
      <p className="text-xs text-muted">{scopeHint}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!categoryId) return;
          run(
            () =>
              addBudgetLine({
                view,
                month,
                categoryId,
                subcategoryId: type === "sub" ? id : null,
                kind,
                amount,
              }),
            () => {
              setChoice("");
              setAmount("");
            },
          );
        }}
        className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]"
      >
        <select value={choice} onChange={(event) => choose(event.target.value)} aria-label="Category" className={`${inputClass} py-1.5`}>
          <option value="">Choose a category…</option>
          {groups.map((group) => (
            <optgroup key={group.id} label={group.name}>
              <option value={`cat:${group.id}`}>All of {group.name}</option>
              {group.children.map((child) => (
                <option key={child.id} value={`sub:${child.id}`}>
                  {child.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <select value={kind} onChange={(event) => setKind(event.target.value as BudgetKind)} aria-label="Kind" className={`${inputClass} py-1.5`}>
          {BUDGET_KINDS.map((option) => (
            <option key={option} value={option}>
              {BUDGET_KIND_LABELS[option]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm">
          $
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="per month"
            aria-label="Monthly amount"
            className={`${inputClass} w-28 py-1.5`}
          />
        </label>
        <button type="submit" disabled={pending || !categoryId || amount.trim() === ""} className={primaryButton}>
          Add
        </button>
      </form>
      {choice && (
        <p className="mt-2 text-xs text-muted">
          {average
            ? `You've spent about ${formatCentsRounded(average)} a month on this over the last ${averageMonths === 1 ? "month" : `${averageMonths} months`}.`
            : "No recent spending here."}{" "}
          {BUDGET_KIND_HINTS[kind]}
        </p>
      )}
      <Feedback error={error} message={message} />
      {averageMonths > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => addSuggestedBudgets({ view, month }))}
            className={smallButton}
          >
            Suggest budgets from my recent spending
          </button>
          <p className="mt-1 text-xs text-muted">
            Adds a budget for each category you spent on recently that doesn&apos;t have one, set to your average. You can
            change any of them.
          </p>
        </div>
      )}
    </section>
  );
}
