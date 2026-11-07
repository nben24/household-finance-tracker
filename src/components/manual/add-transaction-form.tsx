"use client";

import Link from "next/link";
import { useState } from "react";
import { addManualTransaction } from "@/app/(app)/transactions/actions";
import type { CategoryGroup } from "@/components/review/review-card";
import { Feedback, inputClass, primaryButton, useSettingsAction } from "@/components/settings/use-settings-action";
import { NEW_CASH_ACCOUNT } from "@/lib/import/manual";

interface AccountOption {
  id: string;
  label: string;
  isCash: boolean;
}

const chipClass = (selected: boolean) =>
  `rounded-full border px-3 py-1 text-xs font-medium ${
    selected ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-text"
  }`;

const KINDS = [
  { value: "spending", label: "Spending", direction: "out" },
  { value: "refund", label: "Refund", direction: "in" },
  { value: "income", label: "Income", direction: "in" },
] as const;

export function AddTransactionForm({
  accounts,
  defaultAccountId,
  groups,
  today,
  hasCashAccount,
}: {
  accounts: AccountOption[];
  defaultAccountId: string;
  groups: CategoryGroup[];
  today: string;
  hasCashAccount: boolean;
}) {
  const { pending, error, message, run } = useSettingsAction();
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("spending");
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [subcategoryId, setSubcategoryId] = useState("");
  const [notes, setNotes] = useState("");
  const [expectPost, setExpectPost] = useState(true);
  const [keepPrivate, setKeepPrivate] = useState(false);

  const isCash = accountId === NEW_CASH_ACCOUNT || accounts.find((a) => a.id === accountId)?.isCash === true;
  const direction = KINDS.find((option) => option.value === kind)!.direction;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () =>
            addManualTransaction({
              date,
              amount,
              direction,
              merchant,
              accountId,
              kind,
              subcategoryId: kind === "income" ? null : subcategoryId || null,
              notes,
              expectPost: expectPost && !isCash,
              keepPrivate: keepPrivate && kind !== "income",
            }),
          () => {
            setAmount("");
            setMerchant("");
            setSubcategoryId("");
            setNotes("");
            setKeepPrivate(false);
          },
        );
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((option) => (
          <button key={option.value} type="button" onClick={() => setKind(option.value)} className={chipClass(kind === option.value)}>
            {option.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-muted">
          Amount
          <span className="mt-1 flex items-center gap-1 text-sm text-text">
            $
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              required
              placeholder="0.00"
              className={`w-full ${inputClass}`}
            />
          </span>
        </label>
        <label className="text-xs font-medium text-muted">
          Date
          <input
            type="date"
            value={date}
            max={today}
            onChange={(event) => setDate(event.target.value)}
            required
            className={`mt-1 w-full ${inputClass}`}
          />
        </label>
        <label className="text-xs font-medium text-muted sm:col-span-2">
          Where
          <input
            value={merchant}
            onChange={(event) => setMerchant(event.target.value)}
            required
            maxLength={80}
            placeholder="e.g. Local Diner"
            className={`mt-1 w-full ${inputClass}`}
          />
        </label>
        <label className="text-xs font-medium text-muted">
          Paid with
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)} required className={`mt-1 w-full ${inputClass}`}>
            <option value="">Choose…</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
            {!hasCashAccount && <option value={NEW_CASH_ACCOUNT}>Cash</option>}
          </select>
        </label>
        {kind !== "income" && (
          <label className="text-xs font-medium text-muted">
            Category (optional)
            <select value={subcategoryId} onChange={(event) => setSubcategoryId(event.target.value)} className={`mt-1 w-full ${inputClass}`}>
              <option value="">Let the app decide, or ask at review</option>
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
          </label>
        )}
        <label className="text-xs font-medium text-muted sm:col-span-2">
          Note (optional)
          <input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} className={`mt-1 w-full ${inputClass}`} />
        </label>
      </div>

      {isCash ? (
        <p className="text-xs text-muted">Cash never shows up in a bank download, so this entry stays as you typed it.</p>
      ) : (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={expectPost} onChange={(event) => setExpectPost(event.target.checked)} className="mt-0.5 h-4 w-4" />
          <span>
            This will show up in a later bank download
            <span className="block text-xs text-muted">
              When it does, the bank&apos;s version replaces this entry (same account, within a few days and about the same
              amount, so a tip is fine). Your category and note are kept.
            </span>
          </span>
        </label>
      )}

      {kind !== "income" && (
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={keepPrivate} onChange={(event) => setKeepPrivate(event.target.checked)} className="h-3.5 w-3.5" />
          Keep private (only you will see it)
        </label>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Link href="/transactions" className="text-sm font-medium text-muted hover:text-text">
          Done
        </Link>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Adding…" : "Add transaction"}
        </button>
      </div>
      <Feedback error={error} message={message} />
    </form>
  );
}
