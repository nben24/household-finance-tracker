"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  addAccount,
  previewImport,
  saveImport,
  sortImport,
  type FilePreview,
  type PreviewRow,
  type SaveResult,
  type SortResult,
} from "@/app/(app)/import/actions";
import { chipClass, inputClass, linkButton, primaryButton, secondaryButton } from "@/components/styles";
import { formatDay, formatDayWithYear } from "@/lib/dates";
import { ACCOUNT_TYPES, type AccountRow, type AccountType } from "@/lib/db/types";
import { parseCsvFile, parseSpreadsheetFile } from "@/lib/import/parse-file";
import type { ParsedFile } from "@/lib/import/types";
import { ACCOUNT_TYPE_LABELS, TRANSACTION_TYPE_LABELS } from "@/lib/labels";
import { formatSignedAmount } from "@/lib/money";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 10;
const cardClass = "rounded-xl border border-line bg-surface p-4 sm:p-5";

interface Person {
  id: string;
  name: string;
}

interface ChosenFile {
  /** this file's own id, so two files with the same name stay apart */
  key: string;
  /** shown name: the file's name, with " (2)" added for a second file of the same name */
  name: string;
  originalName: string;
  size: number;
  lastModified: number;
  parsed: ParsedFile;
  accountId: string;
  /** "Activity downloaded through" — confirmed by the person */
  coveredThrough: string;
}

type Stage = "reading" | "checking" | "saving" | "sorting" | "complete";
const STAGES: { id: Stage; label: string }[] = [
  { id: "reading", label: "Reading files" },
  { id: "checking", label: "Checking duplicates" },
  { id: "saving", label: "Saving transactions" },
  { id: "sorting", label: "Sorting merchants" },
  { id: "complete", label: "Complete" },
];

type Step =
  | { name: "choose" }
  | { name: "preview"; files: FilePreview[] }
  | { name: "saved"; save: Extract<SaveResult, { ok: true }>; sort: SortResult | null };

function accountLabel(account: AccountRow): string {
  return `${account.institution} ${account.account_name}`;
}

/** Preselect an account only when exactly one fits the file's bank and account kind. */
function suggestAccount(parsed: ParsedFile, accounts: AccountRow[]): string {
  if (parsed.status !== "ok") return "";
  const fits = accounts.filter(
    (account) =>
      account.institution.toLowerCase() === parsed.institution.toLowerCase() &&
      parsed.accountTypes.includes(account.account_type),
  );
  return fits.length === 1 ? fits[0].id : "";
}

function plural(count: number, word: string, many = `${word}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? word : many}`;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16),
      );
}

function Notice({ children, tone = "notice" }: { children: React.ReactNode; tone?: "notice" | "info" }) {
  return (
    <p
      role={tone === "notice" ? "alert" : "status"}
      className={`rounded-lg px-3 py-2 text-sm ${tone === "notice" ? "bg-notice-soft text-notice" : "bg-accent-soft text-accent"}`}
    >
      {children}
    </p>
  );
}

/** Where the import is: done, now, and still to come. Announced as it changes. */
function StageList({ current, failed, waiting = false }: { current: Stage; failed?: Stage; waiting?: boolean }) {
  // waiting: everything before `current` is done, and `current` hasn't started (it's up to the person)
  const index = STAGES.findIndex((stage) => stage.id === current);
  return (
    <div>
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]" aria-label="Import progress">
        {STAGES.map((stage, i) => {
          const state =
            failed === stage.id
              ? "failed"
              : i < index || current === "complete"
                ? "done"
                : i === index && !waiting
                  ? "current"
                  : "todo";
          return (
            <li
              key={stage.id}
              aria-current={state === "current" ? "step" : undefined}
              className={
                state === "failed"
                  ? "font-medium text-notice"
                  : state === "current"
                    ? "font-semibold text-accent"
                    : state === "done"
                      ? "text-text"
                      : "text-muted"
              }
            >
              <span aria-hidden="true">{state === "done" ? "✓ " : state === "failed" ? "! " : state === "current" ? "● " : "○ "}</span>
              {stage.label}
              <span className="sr-only">
                {state === "done" ? " (done)" : state === "current" ? " (in progress)" : state === "failed" ? " (didn't finish)" : ""}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="sr-only" aria-live="polite">
        {failed
          ? `${STAGES.find((s) => s.id === failed)?.label} didn't finish.`
          : waiting
            ? `${STAGES[index - 1]?.label ?? ""} done.`
            : `${STAGES[index]?.label ?? ""}`}
      </p>
    </div>
  );
}

function NewAccountForm({
  institution,
  accountType,
  people,
  defaultOwnerId,
  onAdded,
  onCancel,
}: {
  institution: string;
  accountType: AccountType;
  people: Person[];
  defaultOwnerId: string;
  onAdded: (account: AccountRow) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const errorId = useId();

  function submit(formData: FormData) {
    setError("");
    startTransition(async () => {
      const result = await addAccount({
        institution: String(formData.get("institution") ?? ""),
        accountName: String(formData.get("accountName") ?? ""),
        accountType: String(formData.get("accountType") ?? ""),
        ownerId: String(formData.get("ownerId") ?? ""),
        lastFour: String(formData.get("lastFour") ?? ""),
      });
      if (result.ok) onAdded(result.account);
      else setError(result.error);
    });
  }

  return (
    <form action={submit} aria-describedby={error ? errorId : undefined} className="mt-3 grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2">
      <label className="text-xs font-medium text-muted">
        Bank
        <input name="institution" defaultValue={institution} required className={`mt-1 w-full ${inputClass}`} />
      </label>
      <label className="text-xs font-medium text-muted">
        Name for this account
        <input name="accountName" placeholder="e.g. Everyday Checking" required className={`mt-1 w-full ${inputClass}`} />
      </label>
      <label className="text-xs font-medium text-muted">
        Kind of account
        <select name="accountType" defaultValue={accountType} className={`mt-1 w-full ${inputClass}`}>
          {ACCOUNT_TYPES.map((type) => (
            <option key={type} value={type}>
              {ACCOUNT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium text-muted">
        Whose is it?
        <select name="ownerId" defaultValue={defaultOwnerId} className={`mt-1 w-full ${inputClass}`}>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
          <option value="">Joint (both of you)</option>
        </select>
        <span className="mt-1 block font-normal">Joint means its purchases appear under Shared.</span>
      </label>
      <label className="text-xs font-medium text-muted">
        Last four digits (optional)
        <input name="lastFour" inputMode="numeric" maxLength={4} pattern="\d{4}" className={`mt-1 w-full ${inputClass}`} />
      </label>
      <div className="flex items-end justify-end gap-2">
        <button type="button" onClick={onCancel} className={secondaryButton}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Adding…" : "Add account"}
        </button>
      </div>
      {error && (
        <div id={errorId} className="sm:col-span-2">
          <Notice>{error}</Notice>
        </div>
      )}
    </form>
  );
}

function RowTable({
  rows,
  caption,
  privacy,
  onTogglePrivate,
}: {
  rows: PreviewRow[];
  caption: string;
  privacy?: Map<string, boolean>;
  onTogglePrivate?: (key: string, value: boolean) => void;
}) {
  const showPrivate = Boolean(onTogglePrivate) && rows.some((row) => row.privateEligible);
  return (
    <div className="mt-2 max-h-96 overflow-auto rounded-lg border border-line" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-surface text-xs text-muted shadow-[0_1px_0_var(--line)]">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Date</th>
            <th scope="col" className="px-3 py-2 font-medium">Merchant</th>
            <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">Kind</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
            {showPrivate && (
              <th scope="col" className="px-3 py-2 text-center font-medium">
                Private
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row, index) => (
            <tr key={`${row.key}-${index}`} className="align-top">
              <td className="whitespace-nowrap px-3 py-2 text-muted tabular">{formatDay(row.date)}</td>
              <td className="px-3 py-2">
                <span className="break-anywhere font-medium">{row.merchant}</span>
                <span className="block max-w-[14rem] truncate text-xs text-muted" title={row.description}>
                  {row.description}
                </span>
                {row.needsReview && <span className="block text-xs text-notice">Will wait for a decision</span>}
              </td>
              <td className="hidden whitespace-nowrap px-3 py-2 text-muted sm:table-cell">{TRANSACTION_TYPE_LABELS[row.type]}</td>
              <td className={`whitespace-nowrap px-3 py-2 text-right font-medium tabular ${row.amount > 0 ? "text-accent" : ""}`}>
                {formatSignedAmount(row.amount)}
              </td>
              {showPrivate && (
                <td className="px-3 py-2 text-center">
                  {row.privateEligible && (
                    <label className="inline-flex min-h-9 min-w-9 items-center justify-center">
                      <input
                        type="checkbox"
                        checked={privacy?.get(row.key) ?? false}
                        onChange={(event) => onTogglePrivate?.(row.key, event.target.checked)}
                        className="h-4 w-4"
                      />
                      <span className="sr-only">Keep {row.merchant} private</span>
                    </label>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <p className="text-xl font-semibold tabular">{value.toLocaleString("en-US")}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

export function ImportFlow({
  initialAccounts,
  people,
  currentUserId,
  today,
  unfinished,
}: {
  initialAccounts: AccountRow[];
  people: Person[];
  currentUserId: string;
  /** the household's date, the latest a download can run through */
  today: string;
  /** your last import, if it stopped before finishing */
  unfinished: { batchId: string; saved: number; status: "saving" | "saved" } | null;
}) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [files, setFiles] = useState<ChosenFile[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ name: "choose" });
  const [stage, setStage] = useState<Stage | null>(null);
  const [failedStage, setFailedStage] = useState<Stage | undefined>();
  const [error, setError] = useState("");
  const [ignoreBefore, setIgnoreBefore] = useState("");
  const [batchId, setBatchId] = useState(() => newId());
  const [privacy, setPrivacy] = useState(new Map<string, boolean>());
  const [revealOn, setRevealOn] = useState("");
  const [answers, setAnswers] = useState(new Map<string, boolean>());
  const [resume, setResume] = useState(unfinished);
  const [pending, startTransition] = useTransition();
  const reading = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the new step's heading so keyboard and screen-reader users follow along.
  useEffect(() => {
    if (step.name !== "choose") headingRef.current?.focus();
  }, [step.name]);

  const keep = (date: string) => ignoreBefore === "" || date >= ignoreBefore;
  const kept = (file: ChosenFile) => (file.parsed.status === "ok" ? file.parsed.transactions.filter((t) => keep(t.transactionDate)) : []);
  const lastDate = (file: ChosenFile) => kept(file).reduce((max, t) => (t.transactionDate > max ? t.transactionDate : max), "");
  const ignoredCount = (file: ChosenFile) => (file.parsed.status === "ok" ? file.parsed.transactions.length - kept(file).length : 0);
  const totalIgnored = files.reduce((total, file) => total + ignoredCount(file), 0);

  const readable = files.filter((file) => file.parsed.status === "ok" && file.parsed.transactions.length > 0);
  const readyToCheck =
    readable.length > 0 &&
    readable.every((file) => file.accountId !== "") &&
    readable.some((file) => kept(file).length > 0) &&
    readable.every((file) => kept(file).length === 0 || (file.coveredThrough >= lastDate(file) && file.coveredThrough <= today));
  const unreadableRows = files.reduce((total, file) => total + (file.parsed.status === "ok" ? file.parsed.problems.length : 0), 0);

  // Only the parsed, cleaned-up transactions are sent — never the file itself,
  // and never the per-row balances (only the latest one).
  const filesPayload = () =>
    readable
      .map((file) => ({
        fileKey: file.key,
        fileName: file.name,
        accountId: file.accountId,
        coveredThrough: file.coveredThrough || null,
        transactions: kept(file).map((t) => ({ ...t, balance: undefined })),
        latestBalance: file.parsed.status === "ok" ? file.parsed.latestBalance : null,
      }))
      .filter((file) => file.transactions.length > 0);

  const previewRows = step.name === "preview" ? step.files.flatMap((file) => file.fresh) : [];
  const questions = previewRows.filter((row) => row.match?.strength === "possible");
  const unanswered = questions.filter((row) => !answers.has(`${row.match!.entryId}|${row.key}`));
  const request = () => ({
    batchId,
    files: filesPayload(),
    privateChoices: [...privacy.entries()].filter(([, on]) => on).map(([sourceHash]) => ({ sourceHash, until: revealOn || null })),
    matchDecisions: [...answers.entries()].map(([key, same]) => {
      const [entryId, sourceHash] = key.split("|");
      return { entryId, sourceHash, same };
    }),
  });

  async function chooseFiles(list: FileList | null) {
    // One selection at a time, so a second pick can't overwrite the first while it's being read.
    if (!list || reading.current) return;
    reading.current = true;
    setStage("reading");
    setError("");
    const messages: string[] = [];
    const chosen: ChosenFile[] = [...files];
    try {
      for (const file of Array.from(list)) {
        if (chosen.length >= MAX_FILES) {
          messages.push(`You can import up to ${MAX_FILES} files at a time; the rest weren't added.`);
          break;
        }
        const same = chosen.find(
          (existing) => existing.originalName === file.name && existing.size === file.size && existing.lastModified === file.lastModified,
        );
        if (same) {
          messages.push(`${file.name} is already in the list, so it wasn't added again.`);
          continue;
        }
        const sameName = chosen.filter((existing) => existing.originalName === file.name).length;
        const name = sameName > 0 ? `${file.name} (${sameName + 1})` : file.name;
        if (sameName > 0) {
          messages.push(`Two different files are named ${file.name}; the new one is shown as “${name}”. Remove either if it was a mistake.`);
        }
        // Let the page update between files so it stays responsive.
        await new Promise((resolve) => setTimeout(resolve, 0));
        let parsed: ParsedFile;
        if (!/\.(csv|xlsx)$/i.test(file.name)) {
          parsed = { status: "unreadable", message: "This isn't a CSV or Excel (.xlsx) file." };
        } else if (file.size > MAX_FILE_BYTES) {
          parsed = { status: "unreadable", message: "This file is too large (5 MB limit)." };
        } else if (/\.xlsx$/i.test(file.name)) {
          parsed = parseSpreadsheetFile(new Uint8Array(await file.arrayBuffer()));
        } else {
          parsed = parseCsvFile(await file.text());
        }
        const last =
          parsed.status === "ok" ? parsed.transactions.reduce((max, t) => (t.transactionDate > max ? t.transactionDate : max), "") : "";
        chosen.push({
          key: newId(),
          name,
          originalName: file.name,
          size: file.size,
          lastModified: file.lastModified,
          parsed,
          accountId: suggestAccount(parsed, accounts),
          coveredThrough: last && last <= today ? last : today,
        });
      }
      setFiles(chosen);
      setNotices(messages);
    } finally {
      reading.current = false;
      setStage(null);
    }
  }

  function updateFile(key: string, changes: Partial<ChosenFile>) {
    setFiles((current) => current.map((file) => (file.key === key ? { ...file, ...changes } : file)));
  }

  function startOver() {
    setFiles([]);
    setNotices([]);
    setStep({ name: "choose" });
    setStage(null);
    setFailedStage(undefined);
    setError("");
    setIgnoreBefore("");
    setPrivacy(new Map());
    setRevealOn("");
    setAnswers(new Map());
    setBatchId(newId());
  }

  function check() {
    setError("");
    setStage("checking");
    setFailedStage(undefined);
    startTransition(async () => {
      const result = await previewImport({ batchId, files: filesPayload() });
      if (result.ok) {
        setStep({ name: "preview", files: result.files });
        setStage(null);
      } else {
        setError(result.error);
        setFailedStage("checking");
      }
    });
  }

  function runSort(saved: Extract<SaveResult, { ok: true }>) {
    setStage("sorting");
    setFailedStage(undefined);
    startTransition(async () => {
      const sort = await sortImport({ batchId: saved.batchId });
      setStep({ name: "saved", save: saved, sort });
      if (sort.ok) {
        setStage("complete");
        setResume(null);
      } else {
        setFailedStage("sorting");
      }
    });
  }

  function save() {
    setError("");
    setStage("saving");
    setFailedStage(undefined);
    startTransition(async () => {
      const saved = await saveImport(request());
      if (!saved.ok) {
        setError(saved.error);
        setFailedStage("saving");
        return;
      }
      setStep({ name: "saved", save: saved, sort: null });
      runSort(saved);
    });
  }

  function finishUnfinished() {
    if (!resume) return;
    const placeholder = { ok: true as const, batchId: resume.batchId, added: resume.saved, matched: 0, duplicatesSkipped: 0, keptPrivate: 0 };
    runSort(placeholder);
  }

  // ---- After saving --------------------------------------------------------
  if (step.name === "saved") {
    const { save: saved, sort } = step;
    const sorted = sort?.ok ? sort : null;
    const fromEarlier = sorted ? sorted.allWaiting - sorted.newDecisions : 0;
    return (
      <section className={cardClass} aria-labelledby="import-done-heading">
        <h2 id="import-done-heading" ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
          {sorted ? "Import complete" : sort && !sort.ok ? "Transactions saved — sorting didn't finish" : "Transactions saved"}
        </h2>
        <div className="mt-2">
          <StageList current={stage ?? "sorting"} failed={failedStage} />
        </div>
        <ul className="mt-4 flex flex-col gap-1 text-sm">
          <li>{plural(saved.added, "transaction")} added</li>
          {saved.matched > 0 && <li>{plural(saved.matched, "hand-added entry", "hand-added entries")} matched and updated</li>}
          {saved.keptPrivate > 0 && <li>{plural(saved.keptPrivate, "purchase")} kept private</li>}
          <li>{plural(saved.duplicatesSkipped, "duplicate")} skipped</li>
          {sorted?.ai && sorted.ai.asked > 0 && (
            <li>
              {plural(sorted.ai.asked, "new merchant")} sorted by AI ({sorted.ai.confident} confidently)
            </li>
          )}
          {sorted && (
            <li>
              {sorted.newDecisions > 0
                ? `${plural(sorted.newDecisions, "transaction")} from this import ${sorted.newDecisions === 1 ? "needs" : "need"} a decision`
                : "Nothing from this import needs a decision"}
              {fromEarlier > 0 && `, plus ${plural(fromEarlier, "from an earlier import", "from earlier imports")}`}
            </li>
          )}
          {sorted && sorted.newCatchUp > 0 && (
            <li>{plural(sorted.newCatchUp, "older transaction")} from this import went to Catch-up (history before weekly reviews start)</li>
          )}
        </ul>
        {sorted?.ai?.problem && (
          <div className="mt-3">
            <Notice tone="info">{sorted.ai.problem}</Notice>
          </div>
        )}
        {sort && !sort.ok && (
          <div className="mt-3">
            <Notice>{sort.error}</Notice>
          </div>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          {sort && !sort.ok && (
            <button type="button" disabled={pending} onClick={() => runSort(saved)} className={primaryButton}>
              {pending ? "Sorting…" : "Try sorting again"}
            </button>
          )}
          {sorted &&
            (sorted.allWaiting > 0 ? (
              <Link href="/review" className={primaryButton}>
                Review {plural(sorted.allWaiting, "transaction")}
              </Link>
            ) : (
              <Link href="/" className={primaryButton}>
                Check dashboard
              </Link>
            ))}
          {sorted && sorted.allCatchUp > 0 && (
            <Link href="/catch-up" className={secondaryButton}>
              Catch-up ({sorted.allCatchUp.toLocaleString("en-US")} older)
            </Link>
          )}
          <Link href="/transactions?month=all" className={secondaryButton}>
            See transactions
          </Link>
          <button type="button" onClick={startOver} disabled={pending} className={secondaryButton}>
            Import more
          </button>
        </div>
      </section>
    );
  }

  // ---- Preview ---------------------------------------------------------------
  if (step.name === "preview") {
    const fresh = step.files.reduce((total, file) => total + file.fresh.length, 0);
    const duplicates = step.files.reduce((total, file) => total + file.duplicates.length, 0);
    const strong = previewRows.filter((row) => row.match?.strength === "strong");
    const chosenPrivate = [...privacy.values()].filter(Boolean).length;
    const eligible = previewRows.some((row) => row.privateEligible);
    const answer = (row: PreviewRow, same: boolean) =>
      setAnswers((current) => new Map(current).set(`${row.match!.entryId}|${row.key}`, same));
    const answerOf = (row: PreviewRow) => answers.get(`${row.match!.entryId}|${row.key}`);

    return (
      <section className={cardClass} aria-labelledby="import-preview-heading">
        <h2 id="import-preview-heading" ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
          Check before saving
        </h2>
        <div className="mt-2">
          <StageList current={stage ?? "saving"} waiting={stage === null} failed={failedStage} />
        </div>
        <p className="mt-3 text-sm text-muted">
          {plural(fresh + duplicates, "transaction")} found
          {totalIgnored > 0 && `, plus ${plural(totalIgnored, "older one")} left out by your cutoff date`}. Nothing has been
          saved yet.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Count label="new" value={fresh} />
          <Count label="already imported" value={duplicates} />
          <Count label="couldn't be read" value={unreadableRows} />
        </div>
        {unreadableRows > 0 && (
          <p className="mt-2 text-[13px] text-muted">
            Rows that couldn&apos;t be read aren&apos;t imported, so their amounts aren&apos;t in any totals. Go back to see
            which lines they were.
          </p>
        )}

        {questions.length > 0 && (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-base font-semibold">Is this the same purchase?</h3>
            <p className="mt-1 text-[13px] text-muted">
              These bank rows are close in date and amount to something you added by hand, but we&apos;re not sure.
              “Same purchase” replaces your entry (keeping your category, note and privacy); “Keep separate” saves both.
            </p>
            <ul className="mt-3 flex flex-col gap-3">
              {questions.map((row) => {
                const value = answerOf(row);
                return (
                  <li key={`${row.match!.entryId}-${row.key}`} className="rounded-lg border border-line p-3">
                    <div className="grid gap-2 text-sm sm:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium text-muted">You added</p>
                        <p className="break-anywhere font-medium">{row.match!.merchant}</p>
                        <p className="text-muted tabular">
                          {formatSignedAmount(row.match!.amount)} · {formatDayWithYear(row.match!.date)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted">From the bank</p>
                        <p className="break-anywhere font-medium">{row.merchant}</p>
                        <p className="text-muted tabular">
                          {formatSignedAmount(row.amount)} · {formatDayWithYear(row.date)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`Is ${row.merchant} the same as your entry?`}>
                      <button type="button" aria-pressed={value === true} onClick={() => answer(row, true)} className={chipClass(value === true)}>
                        Same purchase
                      </button>
                      <button type="button" aria-pressed={value === false} onClick={() => answer(row, false)} className={chipClass(value === false)}>
                        Keep separate
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {strong.length > 0 && (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-base font-semibold">Replacing entries you added by hand</h3>
            <ul className="mt-2 flex flex-col divide-y divide-line text-sm">
              {strong.map((row) => {
                const separate = answerOf(row) === false;
                return (
                  <li key={`${row.match!.entryId}-${row.key}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0 break-anywhere">
                      {row.merchant} {formatSignedAmount(row.amount)}{" "}
                      <span className="text-muted">
                        {separate ? "will be saved separately from" : "replaces"} your entry {row.match!.merchant}{" "}
                        {formatSignedAmount(row.match!.amount)} on {formatDayWithYear(row.match!.date)}
                      </span>
                    </span>
                    <button type="button" aria-pressed={separate} onClick={() => answer(row, !separate ? false : true)} className={linkButton}>
                      {separate ? "Same purchase after all" : "Keep separate"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {eligible && (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-base font-semibold">Keep a purchase private (optional)</h3>
            <p className="mt-1 max-w-prose text-[13px] text-muted">
              Tick “Private” on any of your own purchases below, like a present. The other person won&apos;t see it
              anywhere, it isn&apos;t sent to the AI and it never teaches a sorting rule. It still counts in your own
              numbers.
            </p>
            {chosenPrivate > 0 && (
              <label className="mt-2 block text-xs font-medium text-muted">
                Show {chosenPrivate === 1 ? "it" : "them"} to everyone again on (optional)
                <input type="date" value={revealOn} min={today} onChange={(event) => setRevealOn(event.target.value)} className={`mt-1 block ${inputClass}`} />
                <span className="mt-1 block font-normal">Visible from midnight on that date, household time.</span>
              </label>
            )}
          </div>
        )}

        {step.files.map((file) => {
          const account = accounts.find((candidate) => candidate.id === file.accountId);
          return (
            <div key={file.fileKey} className="mt-5 border-t border-line pt-4">
              <p className="break-anywhere text-sm font-medium">{file.fileName}</p>
              <p className="text-xs text-muted">Going into {account ? accountLabel(account) : "the chosen account"}</p>
              {file.fresh.length > 0 && (
                <details className="mt-3" open={step.files.length === 1 || eligible}>
                  <summary className="min-h-9 cursor-pointer text-sm font-medium text-accent">{plural(file.fresh.length, "new transaction")}</summary>
                  <RowTable
                    rows={file.fresh}
                    caption={`New transactions in ${file.fileName}`}
                    privacy={privacy}
                    onTogglePrivate={(key, value) => setPrivacy((current) => new Map(current).set(key, value))}
                  />
                </details>
              )}
              {file.duplicates.length > 0 && (
                <details className="mt-3">
                  <summary className="min-h-9 cursor-pointer text-sm font-medium text-accent">
                    {plural(file.duplicates.length, "duplicate")} that will be skipped
                  </summary>
                  <p className="mt-1 text-xs text-muted">
                    These match transactions that are already saved (same account, date, amount and description), or
                    appear twice in your files.
                  </p>
                  <RowTable rows={file.duplicates} caption={`Duplicates in ${file.fileName}`} />
                </details>
              )}
            </div>
          );
        })}

        {error && (
          <div className="mt-4">
            <Notice>{error}</Notice>
          </div>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
          {unanswered.length > 0 && (
            <p className="mr-auto text-[13px] text-notice" id="unanswered-note">
              Answer {plural(unanswered.length, "question")} about entries you added by hand first.
            </p>
          )}
          <button type="button" onClick={() => setStep({ name: "choose" })} disabled={pending} className={secondaryButton}>
            Back
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending || unanswered.length > 0}
            aria-describedby={unanswered.length > 0 ? "unanswered-note" : undefined}
            className={primaryButton}
          >
            {pending
              ? stage === "sorting"
                ? "Sorting…"
                : "Saving…"
              : failedStage === "saving"
                ? "Try again"
                : fresh === 0
                  ? "Nothing new — update existing"
                  : `Import ${plural(fresh, "transaction")}`}
          </button>
        </div>
      </section>
    );
  }

  // ---- Choose files ------------------------------------------------------------
  const busy = stage === "reading";
  return (
    <section className={cardClass} aria-busy={busy || pending}>
      {resume && (
        <div className="mb-4">
          <Notice tone="info">
            {resume.status === "saved" ? (
              <>
                Your last import saved {plural(resume.saved, "transaction")} but didn&apos;t finish sorting them.{" "}
                <button type="button" onClick={finishUnfinished} disabled={pending} className="font-semibold underline">
                  {pending ? "Sorting…" : "Finish sorting"}
                </button>
              </>
            ) : (
              <>
                Your last import stopped while saving ({plural(resume.saved, "transaction")} saved). Choose the same files
                again and import — nothing will be saved twice.
              </>
            )}
          </Notice>
        </div>
      )}
      {stage && stage !== "reading" && (
        <div className="mb-4">
          <StageList current={stage} failed={failedStage} />
        </div>
      )}

      <label className="block">
        <span className="text-sm font-medium">Choose files (CSV or Excel)</span>
        <input
          type="file"
          accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          multiple
          disabled={busy || pending}
          onChange={(event) => {
            void chooseFiles(event.target.files);
            event.target.value = "";
          }}
          className="mt-2 block w-full text-sm file:mr-3 file:min-h-10 file:rounded-lg file:border-0 file:bg-accent-soft file:px-4 file:py-2 file:text-sm file:font-semibold file:text-accent disabled:opacity-60"
        />
      </label>
      {busy && (
        <p role="status" className="mt-2 text-sm text-muted">
          Reading files on this device…
        </p>
      )}
      {notices.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {notices.map((notice) => (
            <Notice key={notice} tone="info">
              {notice}
            </Notice>
          ))}
        </div>
      )}

      <details className="mt-4">
        <summary className="min-h-9 cursor-pointer text-sm font-medium text-accent">Leave out older rows (optional)</summary>
        <label className="mt-2 block">
          <span className="text-sm font-medium">Don&apos;t import anything dated before</span>
          <input type="date" value={ignoreBefore} max={today} onChange={(event) => setIgnoreBefore(event.target.value)} className={`mt-1 block ${inputClass}`} />
          <span className="mt-1 block max-w-prose text-[13px] text-muted">
            Earlier rows in the files are skipped entirely. To import your history but only review recent weeks, leave
            this empty and set when weekly reviews begin on the{" "}
            <Link href="/catch-up" className="font-medium text-accent hover:underline">
              Catch-up page
            </Link>{" "}
            instead.
          </span>
        </label>
      </details>

      {files.map((file) => {
        const fileLast = lastDate(file);
        const coverageId = `${file.key}-covered`;
        const coverageInvalid = kept(file).length > 0 && (file.coveredThrough < fileLast || file.coveredThrough > today);
        return (
          <div key={file.key} className="mt-4 border-t border-line pt-4">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 break-anywhere text-sm font-medium">{file.name}</p>
              <button
                type="button"
                onClick={() => setFiles((current) => current.filter((other) => other.key !== file.key))}
                className="min-h-9 shrink-0 text-xs font-medium text-muted hover:text-text"
              >
                Remove<span className="sr-only"> {file.name}</span>
              </button>
            </div>

            {file.parsed.status === "unreadable" ? (
              <div className="mt-2">
                <Notice>{file.parsed.message}</Notice>
              </div>
            ) : (
              <>
                <p className="mt-0.5 text-xs text-muted">
                  {file.parsed.institution} · {plural(file.parsed.transactions.length, "transaction")}
                  {ignoredCount(file) > 0 && ` · ${plural(ignoredCount(file), "older one")} will be left out`}
                </p>
                {file.parsed.problems.length > 0 && (
                  <div className="mt-2 rounded-lg bg-notice-soft px-3 py-2 text-sm text-notice">
                    {plural(file.parsed.problems.length, "row")} couldn&apos;t be read and won&apos;t be imported — their
                    amounts won&apos;t be in any totals.
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer font-medium">Show which lines</summary>
                      <ul className="mt-1 list-disc pl-5">
                        {file.parsed.problems.slice(0, 20).map((problem) => (
                          <li key={problem.rowNumber}>
                            Line {problem.rowNumber}: {problem.problem}
                          </li>
                        ))}
                        {file.parsed.problems.length > 20 && <li>…and {file.parsed.problems.length - 20} more</li>}
                      </ul>
                    </details>
                  </div>
                )}
                {file.parsed.sensitiveHeaders.length > 0 && (
                  <p className="mt-2 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">
                    This file has identifying columns ({file.parsed.sensitiveHeaders.join(", ")}). They were removed on
                    this device and are never sent or stored.
                  </p>
                )}
                {file.parsed.transactions.length > 0 && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-xs font-medium text-muted">
                        Which account is this file from?
                        <select
                          value={file.accountId}
                          onChange={(event) => updateFile(file.key, { accountId: event.target.value })}
                          className={`mt-1 w-full ${inputClass}`}
                        >
                          <option value="">Choose an account…</option>
                          {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {accountLabel(account)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {addingFor !== file.key && (
                        <button type="button" onClick={() => setAddingFor(file.key)} className={`mt-1 ${linkButton} text-xs`}>
                          + Add a new account
                        </button>
                      )}
                    </div>
                    {kept(file).length > 0 && (
                      <label className="text-xs font-medium text-muted" htmlFor={coverageId}>
                        Activity downloaded through
                        <input
                          id={coverageId}
                          type="date"
                          value={file.coveredThrough}
                          min={fileLast}
                          max={today}
                          onChange={(event) => updateFile(file.key, { coveredThrough: event.target.value })}
                          aria-invalid={coverageInvalid || undefined}
                          aria-describedby={`${coverageId}-hint`}
                          className={`mt-1 block w-full ${inputClass}`}
                        />
                        <span id={`${coverageId}-hint`} className={`mt-1 block font-normal ${coverageInvalid ? "text-notice" : ""}`}>
                          {coverageInvalid
                            ? `Choose a date from ${formatDayWithYear(fileLast)} (the last row) to today.`
                            : "The last day your download includes, even if nothing happened that day. It tells the app this account is complete up to then."}
                        </span>
                      </label>
                    )}
                    {addingFor === file.key && (
                      <div className="sm:col-span-2">
                        <NewAccountForm
                          institution={file.parsed.institution}
                          accountType={file.parsed.accountTypes[0]}
                          people={people}
                          defaultOwnerId={currentUserId}
                          onCancel={() => setAddingFor(null)}
                          onAdded={(account) => {
                            setAccounts((current) => [...current, account]);
                            updateFile(file.key, { accountId: account.id });
                            setAddingFor(null);
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}

      {error && (
        <div className="mt-4">
          <Notice>{error}</Notice>
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-line pt-4">
          <button type="button" onClick={startOver} disabled={pending || busy} className={secondaryButton}>
            Start over
          </button>
          <button type="button" onClick={check} disabled={pending || busy || !readyToCheck} className={primaryButton}>
            {pending ? "Checking for duplicates…" : "Check for duplicates"}
          </button>
        </div>
      )}
    </section>
  );
}
