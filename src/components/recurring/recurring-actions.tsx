"use client";

import { markRecurring } from "@/app/(app)/recurring/actions";
import { Feedback, smallButton, useSettingsAction } from "@/components/settings/use-settings-action";
import type { RecurringStatus } from "@/lib/db/types";

export function RecurringActions({ recurringKey, status }: { recurringKey: string; status: RecurringStatus | null }) {
  const { pending, error, run } = useSettingsAction();
  const set = (next: RecurringStatus | null) => run(() => markRecurring({ key: recurringKey, status: next }));
  return (
    <div className="flex flex-col items-end">
      <div className="flex flex-wrap justify-end gap-1.5">
        {status === null ? (
          <>
            <button type="button" disabled={pending} onClick={() => set("stopped")} className={smallButton}>
              It stopped
            </button>
            <button type="button" disabled={pending} onClick={() => set("not_recurring")} className={smallButton}>
              Not recurring
            </button>
          </>
        ) : (
          <button type="button" disabled={pending} onClick={() => set(null)} className={smallButton}>
            Undo
          </button>
        )}
      </div>
      <Feedback error={error} message="" />
    </div>
  );
}
