"use client";

import { useState } from "react";
import { addNetWorthAccount, removeBalance, setAccountActive, updateBalance } from "@/app/(app)/net-worth/actions";
import {
  Feedback,
  inputClass,
  primaryButton,
  smallButton,
  useSettingsAction,
} from "@/components/settings/use-settings-action";
import { formatDayWithYear } from "@/lib/dates";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/db/types";
import { ACCOUNT_TYPE_LABELS } from "@/lib/labels";
import { formatCents } from "@/lib/money";

export interface BalanceHistoryEntry {
  id: string;
  asOf: string;
  cents: number;
  fromImport: boolean;
}

/** Update an account's balance, see its recent history, or retire it. */
export function BalanceControls({
  accountId,
  today,
  history,
  active,
}: {
  accountId: string;
  today: string;
  history: BalanceHistoryEntry[];
  active: boolean;
}) {
  const { pending, error, message, run } = useSettingsAction();
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState("");
  const [asOf, setAsOf] = useState(today);

  if (!active) {
    return (
      <button type="button" disabled={pending} onClick={() => run(() => setAccountActive({ accountId, active: true }))} className={smallButton}>
        Restore
      </button>
    );
  }

  return (
    <div className="text-right">
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-accent hover:underline">
          Update
        </button>
      )}
      {open && (
        <div className="mt-2 rounded-lg border border-line p-3 text-left">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              run(() => updateBalance({ accountId, balance, asOf }), () => setBalance(""));
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <label className="text-xs font-medium text-muted">
              Balance
              <span className="mt-1 flex items-center gap-1 text-sm text-text">
                $
                <input
                  value={balance}
                  onChange={(event) => setBalance(event.target.value)}
                  inputMode="decimal"
                  required
                  className={`w-32 ${inputClass} py-1`}
                />
              </span>
            </label>
            <label className="text-xs font-medium text-muted">
              As of
              <input
                type="date"
                value={asOf}
                max={today}
                onChange={(event) => setAsOf(event.target.value)}
                className={`mt-1 block ${inputClass} py-1`}
              />
            </label>
            <button type="submit" disabled={pending} className={smallButton}>
              Save
            </button>
            <button type="button" onClick={() => setOpen(false)} className={smallButton}>
              Close
            </button>
          </form>
          {history.length > 0 && (
            <ul className="mt-3 divide-y divide-line text-xs">
              {history.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-muted">
                    {formatDayWithYear(entry.asOf)}
                    {entry.fromImport && " · from an import"}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular">{formatCents(entry.cents)}</span>
                    <button type="button" disabled={pending} onClick={() => run(() => removeBalance(entry.id))} className="text-muted hover:text-text" aria-label="Delete this balance">
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setAccountActive({ accountId, active: false }))}
            className="mt-3 text-xs font-medium text-muted hover:text-text"
          >
            Closed, sold or paid off? Retire this account
          </button>
          <Feedback error={error} message={message} />
        </div>
      )}
    </div>
  );
}

export function AddAccountForm({
  people,
  defaultOwnerId,
  today,
}: {
  people: { id: string; name: string }[];
  defaultOwnerId: string;
  today: string;
}) {
  const { pending, error, message, run } = useSettingsAction();
  const [institution, setInstitution] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("retirement");
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [balance, setBalance] = useState("");
  const [asOf, setAsOf] = useState(today);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () => addNetWorthAccount({ institution, name, type, ownerId, balance, asOf }),
          () => {
            setInstitution("");
            setName("");
            setBalance("");
          },
        );
      }}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      <label className="text-xs font-medium text-muted">
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={60} placeholder="e.g. Roth IRA" className={`mt-1 w-full ${inputClass}`} />
      </label>
      <label className="text-xs font-medium text-muted">
        Where it&apos;s held (optional)
        <input value={institution} onChange={(event) => setInstitution(event.target.value)} maxLength={60} placeholder="e.g. Vanguard" className={`mt-1 w-full ${inputClass}`} />
      </label>
      <label className="text-xs font-medium text-muted">
        Kind
        <select value={type} onChange={(event) => setType(event.target.value as AccountType)} className={`mt-1 w-full ${inputClass}`}>
          {ACCOUNT_TYPES.map((option) => (
            <option key={option} value={option}>
              {ACCOUNT_TYPE_LABELS[option]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium text-muted">
        Whose
        <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className={`mt-1 w-full ${inputClass}`}>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
          <option value="">Shared</option>
        </select>
      </label>
      <label className="text-xs font-medium text-muted">
        {["credit_card", "mortgage", "loan"].includes(type) ? "Amount owed" : "Current value"}
        <span className="mt-1 flex items-center gap-1 text-sm text-text">
          $
          <input value={balance} onChange={(event) => setBalance(event.target.value)} inputMode="decimal" required className={`w-full ${inputClass}`} />
        </span>
      </label>
      <label className="text-xs font-medium text-muted">
        As of
        <input type="date" value={asOf} max={today} onChange={(event) => setAsOf(event.target.value)} className={`mt-1 w-full ${inputClass}`} />
      </label>
      <div className="flex items-center justify-end sm:col-span-2 lg:col-span-3">
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Adding…" : "Add account"}
        </button>
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <Feedback error={error} message={message} />
      </div>
    </form>
  );
}
