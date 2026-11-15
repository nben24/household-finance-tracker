import Link from "next/link";
import { formatDayWithYear } from "@/lib/dates";
import { linkButton, primaryButton } from "./styles";

/**
 * Three steps for a household that's just starting: import, choose when weekly
 * reviews begin, then check what couldn't be sorted. Shown until there is
 * activity and a review start date.
 */
export function FirstSteps({
  hasData,
  reviewStartsOn,
  waiting,
}: {
  hasData: boolean;
  reviewStartsOn: string | null;
  waiting: number;
}) {
  const steps = [
    {
      done: hasData,
      title: "Import your bank activity",
      body: (
        <>
          Download a CSV or Excel file from each bank and card, and import them here. You can bring in months of history at
          once. When you add an account, “Joint” means its purchases appear under Shared.
        </>
      ),
      action: (
        <Link href="/import" className={primaryButton}>
          Import
        </Link>
      ),
    },
    {
      done: reviewStartsOn !== null,
      title: "Choose when weekly reviews begin",
      body: reviewStartsOn ? (
        <>Weekly reviews start {formatDayWithYear(reviewStartsOn)}. Anything earlier is history, sorted on the Catch-up page.</>
      ) : (
        <>
          Pick a recent date. Older activity is still imported and counted, but it&apos;s sorted in bulk on the Catch-up
          page instead of one by one in Sunday Review. (This is different from leaving rows out when importing.)
        </>
      ),
      action: (
        <Link href="/catch-up" className={linkButton}>
          Choose a date
        </Link>
      ),
    },
    {
      done: hasData && reviewStartsOn !== null && waiting === 0,
      title: "Check the items we couldn't sort",
      body: <>Sunday Review lists anything the app wasn&apos;t sure about. Each choice can become a rule for next time.</>,
      action: (
        <Link href="/review" className={linkButton}>
          {waiting > 0 ? `Review ${waiting}` : "Open Sunday Review"}
        </Link>
      ),
    },
  ];
  const next = steps.findIndex((step) => !step.done);

  return (
    <section aria-labelledby="first-steps" className="mb-4 rounded-xl border border-line bg-surface p-4 sm:p-5">
      <h2 id="first-steps" className="text-base font-semibold">
        Getting started
      </h2>
      <ol className="mt-3 flex flex-col gap-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span
              aria-hidden="true"
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                step.done ? "bg-accent text-surface" : index === next ? "bg-accent-soft text-accent" : "bg-bg text-muted"
              }`}
            >
              {step.done ? "✓" : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${step.done ? "text-muted line-through decoration-1" : ""}`}>
                {step.title}
                <span className="sr-only">{step.done ? " (done)" : index === next ? " (next)" : ""}</span>
              </p>
              {!step.done && <p className="mt-0.5 text-[13px] text-muted">{step.body}</p>}
              {!step.done && index === next && <div className="mt-2">{step.action}</div>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
