"use client";

import { useId, useState } from "react";
import { linkRefund, removeSplit, saveSplit } from "@/app/(app)/transactions/actions";
import { Feedback, useSettingsAction } from "@/components/settings/use-settings-action";
import { inputClass, linkButton, primaryButton, secondaryButton, smallButton } from "@/components/styles";
import { formatDayWithYear } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import type { CategoryGroup } from "./review-card";

export interface SplitPartView {
  id: string;
  subcategoryId: string | null;
  label: string;
  cents: number;
  note: string | null;
}

/** "12.50" → 1250; anything else → null. Typed amounts are always positive. */
function toCents(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

function CategorySelect({ groups, value, onChange, label }: { groups: CategoryGroup[]; value: string; onChange: (value: string) => void; label: string }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} className={`${inputClass} w-full`}>
      <option value="">Choose a category…</option>
      {groups.map((group) => (
        <optgroup key={group.id} label={group.name}>
          {group.children.map((child) => (
            <option key={child.id} value={child.id}>
              {child.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/**
 * Divide one purchase between categories. The bank's transaction stays as it
 * was imported; the parts must add up to it to the cent before saving.
 */
export function SplitEditor({
  transactionId,
  amountCents,
  groups,
  parts,
  defaultSubcategoryId,
  readOnly,
}: {
  transactionId: string;
  /** the transaction's amount, positive */
  amountCents: number;
  groups: CategoryGroup[];
  parts: SplitPartView[];
  defaultSubcategoryId: string | null;
  readOnly: boolean;
}) {
  const { pending, error, message, run } = useSettingsAction();
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState(() =>
    parts.length > 0
      ? parts.map((part) => ({ subcategoryId: part.subcategoryId ?? "", amount: (part.cents / 100).toFixed(2), note: part.note ?? "" }))
      : [
          { subcategoryId: defaultSubcategoryId ?? "", amount: (amountCents / 100).toFixed(2), note: "" },
          { subcategoryId: "", amount: "", note: "" },
        ],
  );
  const statusId = useId();
  const typed = rows.map((row) => toCents(row.amount) ?? 0);
  const left = amountCents - typed.reduce((a, b) => a + b, 0);
  const complete = left === 0 && rows.every((row, index) => row.subcategoryId && typed[index] > 0);

  if (!editing) {
    return (
      <section className="mt-4 rounded-xl border border-line bg-surface p-4 sm:p-5" aria-labelledby={`${statusId}-title`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${statusId}-title`} className="text-base font-semibold">
            {parts.length > 0 ? `Split between ${parts.length} categories` : "Split purchase"}
          </h2>
          {!readOnly && (
            <button type="button" onClick={() => setEditing(true)} className={smallButton}>
              {parts.length > 0 ? "Change split" : "Split purchase"}
            </button>
          )}
        </div>
        {parts.length > 0 ? (
          <ul className="mt-2 divide-y divide-line text-sm">
            {parts.map((part) => (
              <li key={part.id} className="flex justify-between gap-3 py-1.5">
                <span className="min-w-0 break-anywhere">
                  {part.label}
                  {part.note && <span className="block text-[13px] text-muted">{part.note}</span>}
                </span>
                <span className="shrink-0 tabular">{formatCents(part.cents)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[13px] text-muted">
            For a purchase that covers more than one category, like groceries and household supplies in one store run.
            Totals and budgets then count each part in its own category.
          </p>
        )}
        <Feedback error={error} message={message} />
      </section>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(() => saveSplit({ id: transactionId, parts: rows }), () => setEditing(false));
      }}
      className="mt-4 rounded-xl border border-line bg-surface p-4 sm:p-5"
    >
      <h2 className="text-base font-semibold">Split purchase</h2>
      <p className="mt-1 text-[13px] text-muted">
        Divide {formatCents(amountCents)} between categories. The bank&apos;s transaction stays as it is; it only counts
        once, as these parts. Splits don&apos;t teach sorting rules.
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((row, index) => (
          <li key={index} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_8rem]">
            <CategorySelect
              groups={groups}
              value={row.subcategoryId}
              label={`Category for part ${index + 1}`}
              onChange={(value) => setRows((current) => current.map((r, i) => (i === index ? { ...r, subcategoryId: value } : r)))}
            />
            <label className="flex items-center gap-1 text-sm">
              <span aria-hidden="true">$</span>
              <input
                value={row.amount}
                inputMode="decimal"
                aria-label={`Amount for part ${index + 1}`}
                aria-describedby={statusId}
                onChange={(event) => setRows((current) => current.map((r, i) => (i === index ? { ...r, amount: event.target.value } : r)))}
                className={`${inputClass} w-full`}
              />
            </label>
            <input
              value={row.note}
              maxLength={200}
              placeholder="Note (optional)"
              aria-label={`Note for part ${index + 1}`}
              onChange={(event) => setRows((current) => current.map((r, i) => (i === index ? { ...r, note: event.target.value } : r)))}
              className={`${inputClass} sm:col-span-2`}
            />
            {rows.length > 2 && (
              <button
                type="button"
                onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                className={`${linkButton} justify-self-start text-xs`}
              >
                Remove part {index + 1}
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          disabled={rows.length >= 20}
          onClick={() =>
            setRows((current) => [...current, { subcategoryId: "", amount: left > 0 ? (left / 100).toFixed(2) : "", note: "" }])
          }
          className={smallButton}
        >
          + Add a part
        </button>
        <p id={statusId} aria-live="polite" className={`text-sm font-medium tabular ${left === 0 ? "text-accent" : "text-notice"}`}>
          {left === 0 ? "Adds up exactly" : left > 0 ? `${formatCents(left)} left to divide` : `${formatCents(-left)} too much`}
        </p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
        <button type="submit" disabled={pending || !complete} className={primaryButton}>
          {pending ? "Saving…" : "Save split"}
        </button>
        {parts.length > 0 && (
          <button type="button" disabled={pending} onClick={() => run(() => removeSplit(transactionId), () => setEditing(false))} className={secondaryButton}>
            Don&apos;t split
          </button>
        )}
        <button type="button" onClick={() => setEditing(false)} className={secondaryButton}>
          Cancel
        </button>
      </div>
      <Feedback error={error} message={message} />
    </form>
  );
}

export interface RefundCandidate {
  id: string;
  date: string;
  merchant: string;
  cents: number;
  parts: SplitPartView[];
}

/** On a refund: which purchase it refunds and, for a split purchase, which parts. */
export function RefundLink({
  refundId,
  refundCents,
  linkedId,
  candidates,
  readOnly,
}: {
  refundId: string;
  refundCents: number;
  linkedId: string | null;
  candidates: RefundCandidate[];
  readOnly: boolean;
}) {
  const { pending, error, message, run } = useSettingsAction();
  const [originalId, setOriginalId] = useState(linkedId ?? "");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const original = candidates.find((candidate) => candidate.id === originalId);
  const linked = candidates.find((candidate) => candidate.id === linkedId);
  const typed = Object.values(amounts).reduce((total, text) => total + (toCents(text) ?? 0), 0);

  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-base font-semibold">What does this refund?</h2>
      <p className="mt-1 text-[13px] text-muted">
        {linked
          ? `Linked to ${linked.merchant} on ${formatDayWithYear(linked.date)}.`
          : "Link it to the purchase it gives money back for, so the refund lands in the same categories."}
      </p>
      {!readOnly && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run(() =>
              linkRefund({
                refundId,
                originalId: originalId || null,
                parts: original?.parts.length ? Object.entries(amounts).map(([splitId, amount]) => ({ splitId, amount })) : undefined,
              }),
            );
          }}
          className="mt-3 flex flex-col gap-3"
        >
          <label className="text-xs font-medium text-muted">
            Original purchase
            <select value={originalId} onChange={(event) => setOriginalId(event.target.value)} className={`mt-1 block w-full ${inputClass}`}>
              <option value="">Not linked</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.merchant} · {formatDayWithYear(candidate.date)} · {formatCents(candidate.cents)}
                  {candidate.parts.length > 0 ? ` · split ${candidate.parts.length} ways` : ""}
                </option>
              ))}
            </select>
          </label>
          {original && original.parts.length > 0 && (
            <fieldset>
              <legend className="text-xs font-medium text-muted">How much of each part is being refunded?</legend>
              <ul className="mt-1 flex flex-col gap-2">
                {original.parts.map((part) => (
                  <li key={part.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 break-anywhere">
                      {part.label} <span className="text-muted">({formatCents(part.cents)})</span>
                    </span>
                    <label className="flex items-center gap-1">
                      <span className="sr-only">Refunded from {part.label}</span>$
                      <input
                        value={amounts[part.id] ?? ""}
                        inputMode="decimal"
                        onChange={(event) => setAmounts((current) => ({ ...current, [part.id]: event.target.value }))}
                        className={`${inputClass} w-28`}
                      />
                    </label>
                  </li>
                ))}
              </ul>
              <p aria-live="polite" className={`mt-2 text-sm tabular ${typed === refundCents ? "text-accent" : "text-notice"}`}>
                {typed === refundCents
                  ? "Adds up to the refund exactly"
                  : `${formatCents(Math.abs(refundCents - typed))} ${typed < refundCents ? "of the refund still to place" : "more than the refund"}`}
              </p>
            </fieldset>
          )}
          <div>
            <button
              type="submit"
              disabled={pending || (original !== undefined && original.parts.length > 0 && typed !== refundCents)}
              className={smallButton}
            >
              {pending ? "Saving…" : originalId ? "Link refund" : "Save"}
            </button>
          </div>
        </form>
      )}
      <Feedback error={error} message={message} />
    </section>
  );
}
