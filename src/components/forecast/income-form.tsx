"use client";

import { useState } from "react";
import { removeIncome, saveIncome } from "@/app/(app)/forecast/actions";
import {
  Feedback,
  inputClass,
  primaryButton,
  smallButton,
  useSettingsAction,
} from "@/components/settings/use-settings-action";
import type { IncomeFrequency } from "@/lib/db/types";

const FREQUENCY_LABELS: Record<IncomeFrequency, string> = {
  semimonthly: "Twice a month, on two set days",
  biweekly: "Every two weeks",
  weekly: "Every week",
  monthly: "Once a month",
};

export interface IncomeEntry {
  id: string;
  personId: string;
  name: string;
  amount: string;
  frequency: IncomeFrequency;
  anchorDate: string;
  secondDay: string;
}

export function IncomeForm({
  people,
  initial,
  onDone,
}: {
  people: { id: string; name: string }[];
  initial?: IncomeEntry;
  onDone?: () => void;
}) {
  const { pending, error, message, run } = useSettingsAction();
  const [personId, setPersonId] = useState(initial?.personId ?? people[0]?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [frequency, setFrequency] = useState<IncomeFrequency>(initial?.frequency ?? "semimonthly");
  const [anchorDate, setAnchorDate] = useState(initial?.anchorDate ?? "");
  const [secondDay, setSecondDay] = useState(initial?.secondDay ?? "");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () => saveIncome({ id: initial?.id, personId, name, amount, frequency, anchorDate, secondDay }),
          () => {
            if (!initial) {
              setName("");
              setAmount("");
              setAnchorDate("");
              setSecondDay("");
            }
            onDone?.();
          },
        );
      }}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      <label className="text-xs font-medium text-muted">
        Whose
        <select value={personId} onChange={(event) => setPersonId(event.target.value)} className={`mt-1 w-full ${inputClass}`}>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
          <option value="">Shared</option>
        </select>
      </label>
      <label className="text-xs font-medium text-muted">
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={60} placeholder="e.g. Paycheck" className={`mt-1 w-full ${inputClass}`} />
      </label>
      <label className="text-xs font-medium text-muted">
        Take-home amount each time
        <span className="mt-1 flex items-center gap-1 text-sm text-text">
          $
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required className={`w-full ${inputClass}`} />
        </span>
      </label>
      <label className="text-xs font-medium text-muted">
        How often
        <select value={frequency} onChange={(event) => setFrequency(event.target.value as IncomeFrequency)} className={`mt-1 w-full ${inputClass}`}>
          {(Object.keys(FREQUENCY_LABELS) as IncomeFrequency[]).map((option) => (
            <option key={option} value={option}>
              {FREQUENCY_LABELS[option]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium text-muted">
        {frequency === "semimonthly" ? "One payday (any recent one)" : "A recent payday"}
        <input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} required className={`mt-1 w-full ${inputClass}`} />
      </label>
      {frequency === "semimonthly" && (
        <label className="text-xs font-medium text-muted">
          The other payday (day of the month)
          <input
            value={secondDay}
            onChange={(event) => setSecondDay(event.target.value)}
            inputMode="numeric"
            required
            placeholder="e.g. 21"
            className={`mt-1 w-full ${inputClass}`}
          />
        </label>
      )}
      <div className="flex items-center justify-end gap-2 sm:col-span-2 lg:col-span-3">
        {initial && (
          <>
            <button type="button" disabled={pending} onClick={() => run(() => removeIncome(initial.id), onDone)} className={smallButton}>
              Remove
            </button>
            <button type="button" onClick={onDone} className={smallButton}>
              Cancel
            </button>
          </>
        )}
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Saving…" : initial ? "Save" : "Add expected income"}
        </button>
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <Feedback error={error} message={message} />
      </div>
    </form>
  );
}

export function IncomeRow({ entry, people, label }: { entry: IncomeEntry; people: { id: string; name: string }[]; label: string }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <IncomeForm people={people} initial={entry} onDone={() => setEditing(false)} />;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <button type="button" onClick={() => setEditing(true)} className="text-xs font-medium text-accent hover:underline">
        Change
      </button>
    </div>
  );
}
