"use client";

import { useState } from "react";
import { decideMerchant, setReviewStart, sortWithAi } from "@/app/(app)/catch-up/actions";
import type { CategoryGroup } from "@/components/review/review-card";
import {
  Feedback,
  inputClass,
  primaryButton,
  smallButton,
  useSettingsAction,
} from "@/components/settings/use-settings-action";
import { REVIEW_KINDS, REVIEW_KIND_LABELS, allowsCategory, needsCategory, type ReviewKind } from "@/lib/categories/review";
import type { MerchantGroup } from "@/lib/categories/catch-up";
import { formatDayWithYear } from "@/lib/dates";
import { formatCents } from "@/lib/money";

export function ReviewStartForm({ current, suggested }: { current: string | null; suggested: string }) {
  const { pending, error, message, run } = useSettingsAction();
  const [date, setDate] = useState(current ?? suggested);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(() => setReviewStart({ date }));
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <label className="text-sm font-medium">
        Sunday Review starts on
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={`mt-1 block ${inputClass}`} />
      </label>
      <button type="submit" disabled={pending || !date} className={primaryButton}>
        {current ? "Change" : "Save"}
      </button>
      <div className="basis-full">
        <Feedback error={error} message={message} />
      </div>
    </form>
  );
}

export function AiButton({ merchants }: { merchants: number }) {
  const { pending, error, message, run } = useSettingsAction();
  return (
    <div>
      <button type="button" disabled={pending || merchants === 0} onClick={() => run(sortWithAi)} className={primaryButton}>
        {pending ? "Asking…" : `Sort ${merchants} unfamiliar ${merchants === 1 ? "merchant" : "merchants"} with AI`}
      </button>
      <Feedback error={error} message={message} />
    </div>
  );
}

const chipClass = (selected: boolean) =>
  `rounded-full border px-3 py-1 text-xs font-medium ${
    selected ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-text"
  }`;

export function MerchantCard({
  group,
  groups,
  alwaysDefault,
}: {
  group: MerchantGroup;
  groups: CategoryGroup[];
  alwaysDefault: boolean;
}) {
  const { pending, error, message, run } = useSettingsAction();
  const [kind, setKind] = useState<ReviewKind>(group.kind);
  const [subcategoryId, setSubcategoryId] = useState(group.subcategoryId ?? "");
  const [always, setAlways] = useState(alwaysDefault);
  const canSave = !needsCategory(kind) || subcategoryId !== "";

  return (
    <article className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{group.displayName}</h3>
          <p className="text-xs text-muted">
            {group.count} {group.count === 1 ? "transaction" : "transactions"} ·{" "}
            {group.from === group.to ? formatDayWithYear(group.from) : `${formatDayWithYear(group.from)} – ${formatDayWithYear(group.to)}`}
            {group.bankCategory && group.displayName === group.merchant && ` · bank says “${group.bankCategory}”`}
          </p>
          <p className="truncate text-xs text-muted">{group.example}</p>
        </div>
        <p className="text-sm font-semibold tabular">{formatCents(Math.abs(group.totalCents))}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {REVIEW_KINDS.map((option) => (
          <button key={option} type="button" onClick={() => setKind(option)} className={chipClass(kind === option)}>
            {REVIEW_KIND_LABELS[option]}
          </button>
        ))}
      </div>
      {allowsCategory(kind) && (
        <select
          value={subcategoryId}
          onChange={(event) => setSubcategoryId(event.target.value)}
          aria-label="Category"
          className={`mt-3 w-full ${inputClass}`}
        >
          <option value="">{kind === "payback" ? "No category" : "Choose a category…"}</option>
          {groups.map((parent) => (
            <optgroup key={parent.id} label={parent.name}>
              {parent.children.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {needsCategory(kind) ? (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={always} onChange={(event) => setAlways(event.target.checked)} className="h-4 w-4" />
            Always use this for {group.displayName}
          </label>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={pending || !canSave}
          onClick={() =>
            run(() =>
              decideMerchant({
                merchant: group.merchant,
                kind,
                subcategoryId: allowsCategory(kind) && subcategoryId ? subcategoryId : null,
                always: needsCategory(kind) && always,
              }),
            )
          }
          className={smallButton}
        >
          {pending ? "Saving…" : `Apply to all ${group.count}`}
        </button>
      </div>
      <Feedback error={error} message={message} />
    </article>
  );
}
