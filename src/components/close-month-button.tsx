"use client";

import { closeMonth } from "@/app/(app)/month-end/actions";
import { Feedback, useSettingsAction } from "@/components/settings/use-settings-action";
import { primaryButton } from "@/components/styles";

export function CloseMonthButton({ month, label }: { month: string; label: string }) {
  const { pending, error, message, run } = useSettingsAction();
  return (
    <div>
      <button type="button" disabled={pending} onClick={() => run(() => closeMonth({ month }))} className={primaryButton}>
        {pending ? "Saving…" : label}
      </button>
      <Feedback error={error} message={message} />
    </div>
  );
}
