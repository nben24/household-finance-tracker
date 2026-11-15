"use client";

import { useState } from "react";
import { confirmCoverage } from "@/app/(app)/import/actions";
import { Feedback, useSettingsAction } from "@/components/settings/use-settings-action";
import { inputClass, smallButton } from "@/components/styles";

/** "Nothing new on <account> through <date>" for an account that had no activity. */
export function CoverageConfirm({ accounts, latest }: { accounts: { id: string; name: string }[]; latest: string | null }) {
  const { pending, error, message, run } = useSettingsAction();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [through, setThrough] = useState(latest ?? "");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(() => confirmCoverage({ accountId, through }));
      }}
      className="mt-2 flex flex-wrap items-end gap-2"
    >
      <label className="text-xs font-medium text-muted">
        Account
        <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className={`mt-1 block ${inputClass}`}>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium text-muted">
        Had nothing new through
        <input type="date" required value={through} onChange={(event) => setThrough(event.target.value)} className={`mt-1 block ${inputClass}`} />
      </label>
      <button type="submit" disabled={pending || !accountId} className={smallButton}>
        Confirm
      </button>
      <div className="basis-full">
        <Feedback error={error} message={message} />
      </div>
    </form>
  );
}
