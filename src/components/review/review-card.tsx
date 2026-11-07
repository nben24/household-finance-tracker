"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reviewTransaction } from "@/app/(app)/review/actions";
import {
  REVIEW_KINDS,
  REVIEW_KIND_LABELS,
  allowsCategory,
  needsCategory,
  type ReviewKind,
} from "@/lib/categories/review";
import { formatDayWithYear } from "@/lib/dates";
import { formatSignedAmount } from "@/lib/money";

export interface CategoryGroup {
  id: string;
  name: string;
  children: { id: string; name: string }[];
}

export interface ReviewItem {
  id: string;
  date: string;
  merchant: string;
  description: string;
  amount: number;
  personName: string;
  accountLabel: string;
  kind: ReviewKind;
  /** current or suggested subcategory */
  subcategoryId: string | null;
  reason: string | null;
  alwaysDefault: boolean;
  /** paybacks need an account that belongs to one person */
  paybackAllowed: boolean;
  notes: string | null;
  /** private purchases don't teach rules, so "Always use this" isn't offered */
  isPrivate: boolean;
  /** on a transaction's own page: how many other transactions share its merchant */
  sameMerchantCount?: number;
}

const chipClass = (selected: boolean) =>
  `rounded-full border px-3 py-1 text-xs font-medium ${
    selected ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-text"
  }`;

export function ReviewCard({
  item,
  groups,
  quickPicks,
  mode,
  onSaved,
}: {
  item: ReviewItem;
  groups: CategoryGroup[];
  /** frequently used subcategory ids, offered as one-tap choices */
  quickPicks: string[];
  mode: "queue" | "edit";
  onSaved?: (alsoSorted: number) => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<ReviewKind>(item.kind);
  const [subcategoryId, setSubcategoryId] = useState(item.subcategoryId ?? "");
  const [always, setAlways] = useState(item.alwaysDefault);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [applyToMerchant, setApplyToMerchant] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const labels = new Map(
    groups.flatMap((group) => group.children.map((child) => [child.id, `${group.name} › ${child.name}`] as const)),
  );
  const chips = [...new Set([item.subcategoryId, ...quickPicks].filter((id): id is string => !!id && labels.has(id)))]
    .slice(0, 7);
  const kinds = REVIEW_KINDS.filter((option) => option !== "payback" || item.paybackAllowed || item.kind === "payback");
  const untouched = kind === item.kind && subcategoryId === (item.subcategoryId ?? "");
  const canSave = !needsCategory(kind) || subcategoryId !== "";

  function save() {
    setError("");
    startTransition(async () => {
      const result = await reviewTransaction({
        id: item.id,
        kind,
        subcategoryId: allowsCategory(kind) && subcategoryId ? subcategoryId : null,
        always: needsCategory(kind) && always && !item.isPrivate,
        notes: mode === "edit" ? notes : undefined,
        applyToMerchant: mode === "edit" && applyToMerchant,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved?.(result.alsoSorted);
      router.refresh();
    });
  }

  return (
    <article className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">
            {mode === "queue" && item.isPrivate ? (
              <Link href={`/transactions/${item.id}`} className="hover:underline">
                {item.merchant}
              </Link>
            ) : (
              item.merchant
            )}
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            {formatDayWithYear(item.date)} · {item.personName} · {item.accountLabel}
          </p>
          <p className="mt-0.5 break-words text-xs text-muted">{item.description}</p>
        </div>
        <p className={`shrink-0 text-lg font-semibold tabular ${item.amount > 0 ? "text-accent" : ""}`}>
          {formatSignedAmount(item.amount)}
        </p>
      </div>
      {item.reason && mode === "queue" && (
        <p className="mt-2 text-xs text-notice">{item.reason}</p>
      )}

      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-muted">What is this?</legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {kinds.map((option) => (
            <button key={option} type="button" onClick={() => setKind(option)} className={chipClass(kind === option)}>
              {REVIEW_KIND_LABELS[option]}
            </button>
          ))}
        </div>
        {kind === "payback" && (
          <p className="mt-2 text-xs text-muted">
            Not counted as household spending. Moves this amount from the person who received it to the person
            who sent it.
          </p>
        )}
      </fieldset>

      {allowsCategory(kind) && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted">Category{kind === "payback" && " (optional)"}</p>
          {chips.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {chips.map((id) => (
                <button key={id} type="button" onClick={() => setSubcategoryId(id)} className={chipClass(subcategoryId === id)}>
                  {labels.get(id)}
                </button>
              ))}
            </div>
          )}
          <select
            value={subcategoryId}
            onChange={(event) => setSubcategoryId(event.target.value)}
            aria-label="Category"
            className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          >
            <option value="">{kind === "payback" ? "No category" : "Choose a category…"}</option>
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
          {needsCategory(kind) && !item.isPrivate && (
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={always}
                onChange={(event) => setAlways(event.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                Always use this category for {item.merchant}
                <span className="block text-xs text-muted">
                  {always
                    ? "Future purchases here will be sorted automatically."
                    : "Next time it will be suggested, but you'll still be asked."}
                </span>
              </span>
            </label>
          )}
        </div>
      )}

      {mode === "edit" && (
        <label className="mt-4 block text-xs font-medium text-muted">
          Note (optional)
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={500}
            rows={2}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
          />
        </label>
      )}

      {mode === "edit" && (item.sameMerchantCount ?? 0) > 0 && (
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={applyToMerchant}
            onChange={(event) => setApplyToMerchant(event.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            Also change the {item.sameMerchantCount} other{" "}
            {item.sameMerchantCount === 1 ? "transaction" : "transactions"} from {item.merchant}
            <span className="block text-xs text-muted">Including ones already sorted, so the merchant is fixed everywhere.</span>
          </span>
        </label>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-notice-soft px-3 py-2 text-sm text-notice">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={pending || !canSave}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-surface disabled:opacity-50"
        >
          {pending ? "Saving…" : mode === "queue" && untouched && canSave ? "Looks right" : "Save"}
        </button>
      </div>
    </article>
  );
}

export function ReviewQueue({
  items,
  groups,
  quickPicks,
}: {
  items: ReviewItem[];
  groups: CategoryGroup[];
  quickPicks: string[];
}) {
  const [message, setMessage] = useState("");
  return (
    <div className="flex flex-col gap-3">
      {message && (
        <p role="status" className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
          {message}
        </p>
      )}
      {items.map((item) => (
        <ReviewCard
          key={item.id}
          item={item}
          groups={groups}
          quickPicks={quickPicks}
          mode="queue"
          onSaved={(alsoSorted) =>
            setMessage(
              alsoSorted > 0
                ? `Saved. ${alsoSorted} more from the same place ${alsoSorted === 1 ? "was" : "were"} sorted too.`
                : "",
            )
          }
        />
      ))}
    </div>
  );
}
