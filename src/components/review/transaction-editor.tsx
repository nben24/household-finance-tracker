"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { undoReview } from "@/app/(app)/review/actions";
import { ReviewCard, type CategoryGroup, type ReviewItem } from "./review-card";

export function TransactionEditor({
  item,
  groups,
  quickPicks,
  split = false,
}: {
  item: ReviewItem;
  groups: CategoryGroup[];
  quickPicks: string[];
  /** a split purchase: choosing one category here replaces the split */
  split?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<{ text: string; operationId?: string; error?: boolean } | null>(null);
  const [undoing, startUndo] = useTransition();
  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className={
          status
            ? `mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${status.error ? "bg-notice-soft text-notice" : "bg-accent-soft text-accent"}`
            : "sr-only"
        }
      >
        {status && (
          <>
            <span>{status.text}</span>
            {status.operationId && (
              <button
                type="button"
                disabled={undoing}
                onClick={() =>
                  startUndo(async () => {
                    const result = await undoReview({ operationId: status.operationId! });
                    setStatus(result.ok ? { text: result.message } : { text: result.error, error: true });
                    if (result.ok) router.refresh();
                  })
                }
                className="min-h-9 rounded-lg border border-current px-3 text-sm font-semibold"
              >
                {undoing ? "Undoing…" : "Undo"}
              </button>
            )}
          </>
        )}
      </div>
      {split && (
        <p className="mb-3 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-muted">
          This purchase is split between categories (below). Saving a single category here removes the split.
        </p>
      )}
      <ReviewCard
        item={item}
        groups={groups}
        quickPicks={quickPicks}
        mode="edit"
        onSaved={(result) => setStatus({ text: result.summary, operationId: result.operationId })}
      />
    </>
  );
}
