"use client";

import { useState } from "react";
import { ReviewCard, type CategoryGroup, type ReviewItem } from "./review-card";

export function TransactionEditor({
  item,
  groups,
  quickPicks,
}: {
  item: ReviewItem;
  groups: CategoryGroup[];
  quickPicks: string[];
}) {
  const [message, setMessage] = useState("");
  return (
    <>
      {message && (
        <p role="status" className="mb-3 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
          {message}
        </p>
      )}
      <ReviewCard
        item={item}
        groups={groups}
        quickPicks={quickPicks}
        mode="edit"
        onSaved={(alsoSorted) =>
          setMessage(
            alsoSorted > 0
              ? `Saved. ${alsoSorted} more from the same place ${alsoSorted === 1 ? "was" : "were"} changed too.`
              : "Saved.",
          )
        }
      />
    </>
  );
}
