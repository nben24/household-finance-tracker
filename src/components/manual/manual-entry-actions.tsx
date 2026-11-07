"use client";

import { useRouter } from "next/navigation";
import { deleteManualTransaction, stopWaitingToPost } from "@/app/(app)/transactions/actions";
import { Feedback, smallButton, useSettingsAction } from "@/components/settings/use-settings-action";

/** Delete a hand-added entry, or keep it for good (e.g. it was really cash). */
export function ManualEntryActions({
  id,
  awaitingPost,
  afterDelete,
}: {
  id: string;
  awaitingPost: boolean;
  /** where to go once it's deleted (on its own page) */
  afterDelete?: string;
}) {
  const router = useRouter();
  const { pending, error, message, run } = useSettingsAction();
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {awaitingPost && (
          <button type="button" disabled={pending} onClick={() => run(() => stopWaitingToPost(id))} className={smallButton}>
            Keep — it won&apos;t post
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => deleteManualTransaction(id), afterDelete ? () => router.push(afterDelete) : undefined)}
          className={smallButton}
        >
          Delete
        </button>
      </div>
      <Feedback error={error} message={message} />
    </div>
  );
}
