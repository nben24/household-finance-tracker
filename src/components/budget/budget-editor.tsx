"use client";

import { useId, useState, useTransition } from "react";
import {
  addBudgetLine,
  addSuggestedBudgets,
  changeBudgetLine,
  previewSuggestedBudgets,
  removeBudgetLine,
  type BudgetSuggestion,
} from "@/app/(app)/budget/actions";
import type { CategoryGroup } from "@/components/review/review-card";
import { Feedback, useSettingsAction } from "@/components/settings/use-settings-action";
import { inputClass, linkButton, primaryButton, secondaryButton, smallButton } from "@/components/styles";
import { formatMonth } from "@/lib/dates";
import { BUDGET_KINDS, type BudgetKind } from "@/lib/db/types";
import { budgetStatus } from "@/lib/finance/budgets";
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

/** The bar: teal within budget, amber with a hatched end when over, muted grey for fixed bills. */
export function BudgetBar({ fraction, tone }: { fraction: number; tone: "normal" | "over" | "fixed" }) {
  const fill = tone === "over" ? "bg-notice" : tone === "fixed" ? "bg-muted" : "bg-accent";
  return (
    <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-bg" aria-hidden="true">
      <div className={`h-2 rounded-full ${fill}`} style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }} />
      {tone === "over" && (
        <div
          className="absolute inset-y-0 right-0 w-6"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, transparent 0 3px, color-mix(in srgb, var(--surface) 70%, transparent) 3px 6px)",
          }}
        />
      )}
    </div>
  );
}

function BudgetRow({ row, month, readOnly }: { row: BudgetRowView; month: string; readOnly: boolean }) {
  const { pending, error, message, link, run } = useSettingsAction();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(row.amount));
  const [kind, setKind] = useState<BudgetKind>(row.kind);
  const status = budgetStatus({ ...row, line: { kind: row.kind } }, formatCents);
  const amountId = useId();
  const errorId = useId();

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 break-anywhere text-sm font-medium">
          {row.label}
          {row.owner && <span className="ml-2 rounded-full bg-bg px-2 py-0.5 text-xs font-normal text-muted">{row.owner}</span>}
        </p>
        <p className="text-sm tabular">
          <span className="font-medium">{formatCents(row.spentCents)}</span>
          <span className="text-muted"> of {formatCents(row.budgetCents)}</span>
        </p>
      </div>
      <BudgetBar fraction={status.fraction} tone={status.tone} />
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <span className={status.over ? "font-medium text-notice" : "text-muted"}>
          {status.over && <span aria-hidden="true">▲ </span>}
          {row.fund && (
            <>
              Set aside {formatCentsRounded(row.fund.savedCents)} · spent {formatCentsRounded(row.fund.spentCents)} ·{" "}
            </>
          )}
          {status.text}
        </span>
        {!readOnly && !editing && (
          <button type="button" onClick={() => setEditing(true)} className={linkButton}>
            Change<span className="sr-only"> {row.label}</span>
          </button>
        )}
      </div>
      {editing && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run(() => changeBudgetLine({ id: row.id, month, amount, kind }), () => setEditing(false));
          }}
          className="mt-3 flex flex-wrap items-end gap-2"
        >
          <label htmlFor={amountId} className="text-xs font-medium text-muted">
            Monthly amount
            <span className="mt-1 flex items-center gap-1 text-sm text-text">
              $
              <input
                id={amountId}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className={`${inputClass} w-28`}
              />
            </span>
          </label>
          <label className="text-xs font-medium text-muted">
            Kind
            <select value={kind} onChange={(event) => setKind(event.target.value as BudgetKind)} className={`mt-1 block ${inputClass}`}>
              {BUDGET_KINDS.map((option) => (
                <option key={option} value={option}>
                  {BUDGET_KIND_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={pending} className={smallButton}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" disabled={pending} onClick={() => run(() => removeBudgetLine({ id: row.id, month }))} className={smallButton}>
            Remove
          </button>
          <button type="button" onClick={() => setEditing(false)} className={smallButton}>
            Cancel
          </button>
          <span className="basis-full text-xs text-muted">
            Changes apply from {formatMonth(month)} on; earlier months keep their budget.
          </span>
        </form>
      )}
      <Feedback error={error} message={message} link={link} id={errorId} />
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
          <h2 className="text-base font-semibold">{BUDGET_KIND_LABELS[group.kind]}</h2>
          <p className="text-[13px] text-muted">{BUDGET_KIND_HINTS[group.kind]}</p>
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

/** Suggested budgets to review: nothing is saved until the person confirms. */
function SuggestBudgets({ view, month }: { view: string; month: string }) {
  const { pending: saving, error: saveError, message, run } = useSettingsAction();
  const [loading, startLoading] = useTransition();
  const [error, setError] = useState("");
  const [months, setMonths] = useState(0);
  const [partial, setPartial] = useState<string[]>([]);
  const [rows, setRows] = useState<(BudgetSuggestion & { chosen: boolean; text: string })[] | null>(null);

  function load() {
    setError("");
    startLoading(async () => {
      const result = await previewSuggestedBudgets({ view, month });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMonths(result.months);
      setPartial(result.partialMonths);
      setRows(result.suggestions.map((suggestion) => ({ ...suggestion, chosen: true, text: String(suggestion.amount) })));
    });
  }

  const chosen = rows?.filter((row) => row.chosen) ?? [];
  if (rows === null) {
    return (
      <div className="mt-4 border-t border-line pt-3">
        <button type="button" disabled={loading} onClick={load} className={smallButton}>
          {loading ? "Working out suggestions…" : "Suggest budgets from recent spending…"}
        </button>
        <p className="mt-1 text-xs text-muted">
          Shows a suggested amount for each category you spent on recently that has no budget. You choose which to add.
        </p>
        {error && (
          <p role="alert" className="mt-2 rounded-lg bg-notice-soft px-3 py-2 text-sm text-notice">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      <h3 className="text-sm font-semibold">Suggested budgets</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-muted">Every category with recent spending already has a budget.</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () =>
                addSuggestedBudgets({
                  view,
                  month,
                  items: chosen.map((row) => ({ categoryId: row.categoryId, kind: row.kind, amount: row.text })),
                }),
              () => setRows(null),
            );
          }}
        >
          <p className="mt-1 text-xs text-muted">
            Your average over the last {months === 1 ? "complete month" : `${months} complete months`}, rounded up.
            {partial.length > 0 && ` ${partial.map(formatMonth).join(", ")} left out: not every account was imported.`} Nothing
            is added until you confirm.
          </p>
          <ul className="mt-2 divide-y divide-line">
            {rows.map((row, index) => (
              <li key={row.categoryId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <label className="flex min-h-9 flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={row.chosen}
                    onChange={(event) =>
                      setRows((current) => current!.map((r, i) => (i === index ? { ...r, chosen: event.target.checked } : r)))
                    }
                    className="h-4 w-4"
                  />
                  <span className="break-anywhere">
                    {row.name}
                    <span className="block text-xs text-muted">
                      averages {formatCents(row.averageCents)} · {BUDGET_KIND_LABELS[row.kind]}
                    </span>
                  </span>
                </label>
                <label className="flex items-center gap-1">
                  <span className="sr-only">Monthly budget for {row.name}</span>$
                  <input
                    value={row.text}
                    disabled={!row.chosen}
                    onChange={(event) =>
                      setRows((current) => current!.map((r, i) => (i === index ? { ...r, text: event.target.value } : r)))
                    }
                    inputMode="decimal"
                    className={`${inputClass} w-24`}
                  />
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" disabled={saving || chosen.length === 0} className={primaryButton}>
              {saving ? "Adding…" : `Add ${chosen.length} ${chosen.length === 1 ? "budget" : "budgets"}`}
            </button>
            <button type="button" onClick={() => setRows(null)} className={secondaryButton}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <Feedback error={saveError} message={message} />
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
  const { pending, error, message, link, run } = useSettingsAction();
  const [choice, setChoice] = useState("");
  const [kind, setKind] = useState<BudgetKind>("variable");
  const [amount, setAmount] = useState("");
  const errorId = useId();

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
      <h2 className="text-base font-semibold">Add a budget</h2>
      <p className="text-[13px] text-muted">{scopeHint}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!categoryId) return;
          run(
            () => addBudgetLine({ view, month, categoryId, subcategoryId: type === "sub" ? id : null, kind, amount }),
            () => {
              setChoice("");
              setAmount("");
            },
          );
        }}
        className="mt-3 grid gap-2"
      >
        <label className="text-xs font-medium text-muted">
          Category
          <select
            value={choice}
            onChange={(event) => choose(event.target.value)}
            aria-describedby={error ? errorId : undefined}
            className={`mt-1 w-full ${inputClass}`}
          >
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
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-muted">
            Kind
            <select value={kind} onChange={(event) => setKind(event.target.value as BudgetKind)} className={`mt-1 block ${inputClass}`}>
              {BUDGET_KINDS.map((option) => (
                <option key={option} value={option}>
                  {BUDGET_KIND_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-muted">
            Per month
            <span className="mt-1 flex items-center gap-1 text-sm text-text">
              $
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                className={`${inputClass} w-28`}
              />
            </span>
          </label>
          <button type="submit" disabled={pending || !categoryId || amount.trim() === ""} className={primaryButton}>
            {pending ? "Adding…" : "Add"}
          </button>
        </div>
      </form>
      {choice && (
        <p className="mt-2 text-xs text-muted">
          {average
            ? `You've spent about ${formatCentsRounded(average)} a month on this over the last ${averageMonths === 1 ? "complete month" : `${averageMonths} complete months`}.`
            : "No recent spending here."}{" "}
          {BUDGET_KIND_HINTS[kind]}
        </p>
      )}
      <Feedback error={error} message={message} link={link} id={errorId} />
      {averageMonths > 0 && <SuggestBudgets view={view} month={month} />}
    </section>
  );
}
