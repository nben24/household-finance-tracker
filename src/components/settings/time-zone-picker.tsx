"use client";

import { useState } from "react";
import { setTimeZone } from "@/app/(app)/settings/actions";
import { Feedback, useSettingsAction } from "@/components/settings/use-settings-action";
import { inputClass, smallButton } from "@/components/styles";

export function TimeZonePicker({ current, options, readOnly }: { current: string; options: string[]; readOnly: boolean }) {
  const { pending, error, message, run } = useSettingsAction();
  const [zone, setZone] = useState(current);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(() => setTimeZone({ timeZone: zone }));
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <label className="text-sm font-medium">
        Household time zone
        <select value={zone} disabled={readOnly} onChange={(event) => setZone(event.target.value)} className={`mt-1 block ${inputClass}`}>
          {options.map((option) => (
            <option key={option} value={option}>
              {option.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
      {!readOnly && (
        <button type="submit" disabled={pending || zone === current} className={smallButton}>
          Save
        </button>
      )}
      <p className="basis-full text-[13px] text-muted">
        Decides what “today” is for both of you, and when private purchases are revealed: from midnight on the chosen
        date, in this time zone.
      </p>
      <div className="basis-full">
        <Feedback error={error} message={message} />
      </div>
    </form>
  );
}
