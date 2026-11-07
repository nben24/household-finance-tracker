"use client";

import { useState } from "react";
import { setPrivacy } from "@/app/(app)/transactions/actions";
import { Feedback, inputClass, smallButton, useSettingsAction } from "@/components/settings/use-settings-action";
import { formatDayWithYear } from "@/lib/dates";

/**
 * A quiet "Keep private" link at the bottom of one of your own purchases.
 * The other person can't see a private transaction at all, until the optional date.
 */
export function PrivacyControl({
  id,
  isPrivate,
  until,
  otherName,
  today,
}: {
  id: string;
  isPrivate: boolean;
  until: string | null;
  otherName: string;
  today: string;
}) {
  const { pending, error, message, run } = useSettingsAction();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(until ?? "");
  const stillPrivate = isPrivate && (until === null || until > today);

  if (!open) {
    return (
      <div className="mt-6 text-xs text-muted">
        {stillPrivate ? (
          <>
            Only you can see this{until ? ` until ${formatDayWithYear(until)}` : ""}.{" "}
            <button type="button" onClick={() => setOpen(true)} className="underline hover:text-text">
              Change
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="hover:text-text hover:underline">
            Keep private
          </button>
        )}
        <Feedback error={error} message={message} />
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-line bg-surface p-4 text-sm">
      <p>
        {otherName} won&apos;t see this purchase anywhere — not in lists, totals, budgets or reports. It still counts in
        your own numbers.
      </p>
      <label className="mt-3 block text-xs font-medium text-muted">
        Show it to everyone again on (optional)
        <input
          type="date"
          value={date}
          min={today}
          onChange={(event) => setDate(event.target.value)}
          className={`mt-1 block ${inputClass} py-1`}
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => setPrivacy({ id, keepPrivate: true, until: date || null }), () => setOpen(false))}
          className={smallButton}
        >
          {stillPrivate ? "Save" : "Keep private"}
        </button>
        {stillPrivate && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setPrivacy({ id, keepPrivate: false, until: null }), () => setOpen(false))}
            className={smallButton}
          >
            Show to everyone now
          </button>
        )}
        <button type="button" onClick={() => setOpen(false)} className={smallButton}>
          Cancel
        </button>
      </div>
      <Feedback error={error} message={message} />
    </div>
  );
}
