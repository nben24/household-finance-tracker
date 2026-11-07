"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  addAccount,
  commitImport,
  previewImport,
  type CommitResult,
  type FilePreview,
  type PreviewRow,
} from "@/app/(app)/import/actions";
import { formatDayWithYear } from "@/lib/dates";
import { ACCOUNT_TYPES, type AccountRow, type AccountType } from "@/lib/db/types";
import { parseCsvFile, parseSpreadsheetFile } from "@/lib/import/parse-file";
import type { ParsedFile } from "@/lib/import/types";
import { ACCOUNT_TYPE_LABELS, TRANSACTION_TYPE_LABELS } from "@/lib/labels";
import { formatSignedAmount } from "@/lib/money";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 10;

const controlClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const primaryButton =
  "rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-surface disabled:opacity-50";
const secondaryButton = "rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium";
const cardClass = "rounded-xl border border-line bg-surface p-4 sm:p-5";

interface Person {
  id: string;
  name: string;
}

interface ChosenFile {
  name: string;
  parsed: ParsedFile;
  accountId: string;
}

type Step =
  | { name: "choose" }
  | { name: "preview"; files: FilePreview[] }
  | { name: "done"; result: Extract<CommitResult, { ok: true }> };

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

function plural(count: number, word: string): string {
  return `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-lg bg-notice-soft px-3 py-2 text-sm text-notice">
      {children}
    </p>
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
    <form action={submit} className="mt-3 grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2">
      <label className="text-xs font-medium text-muted">
        Bank
        <input name="institution" defaultValue={institution} required className={`mt-1 ${controlClass}`} />
      </label>
      <label className="text-xs font-medium text-muted">
        Name for this account
        <input name="accountName" placeholder="e.g. Everyday Checking" required className={`mt-1 ${controlClass}`} />
      </label>
      <label className="text-xs font-medium text-muted">
        Kind of account
        <select name="accountType" defaultValue={accountType} className={`mt-1 ${controlClass}`}>
          {ACCOUNT_TYPES.map((type) => (
            <option key={type} value={type}>
              {ACCOUNT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium text-muted">
        Whose is it?
        <select name="ownerId" defaultValue={defaultOwnerId} className={`mt-1 ${controlClass}`}>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
          <option value="">Joint</option>
        </select>
      </label>
      <label className="text-xs font-medium text-muted">
        Last four digits (optional)
        <input name="lastFour" inputMode="numeric" maxLength={4} pattern="\d{4}" className={`mt-1 ${controlClass}`} />
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
        <div className="sm:col-span-2">
          <Notice>{error}</Notice>
        </div>
      )}
    </form>
  );
}

function RowTable({ rows }: { rows: PreviewRow[] }) {
  return (
    <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-line">
      <table className="w-full text-left text-sm">
        <tbody className="divide-y divide-line">
          {rows.map((row, index) => (
            <tr key={index} className="align-top">
              <td className="whitespace-nowrap px-3 py-2 text-muted tabular">{formatDayWithYear(row.date)}</td>
              <td className="px-3 py-2">
                <span className="font-medium">{row.merchant}</span>
                <span className="block text-xs text-muted">{row.description}</span>
                {row.replaces && (
                  <span className="mt-0.5 block text-xs font-medium text-accent">
                    Replaces your entry: {row.replaces.merchant} {formatSignedAmount(row.replaces.amount)} on{" "}
                    {formatDayWithYear(row.replaces.date)}
                  </span>
                )}
              </td>
              <td className="hidden whitespace-nowrap px-3 py-2 text-muted sm:table-cell">
                {TRANSACTION_TYPE_LABELS[row.type]}
              </td>
              <td className={`whitespace-nowrap px-3 py-2 text-right font-medium tabular ${row.amount > 0 ? "text-accent" : ""}`}>
                {formatSignedAmount(row.amount)}
              </td>
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
}: {
  initialAccounts: AccountRow[];
  people: Person[];
  currentUserId: string;
}) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [files, setFiles] = useState<ChosenFile[]>([]);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ name: "choose" });
  const [error, setError] = useState("");
  const [ignoreBefore, setIgnoreBefore] = useState("");
  const [pending, startTransition] = useTransition();

  const keep = (date: string) => ignoreBefore === "" || date >= ignoreBefore;
  const ignoredCount = (file: ChosenFile) =>
    file.parsed.status === "ok" ? file.parsed.transactions.filter((t) => !keep(t.transactionDate)).length : 0;
  const totalIgnored = files.reduce((total, file) => total + ignoredCount(file), 0);

  const readable = files.filter((file) => file.parsed.status === "ok" && file.parsed.transactions.length > 0);
  const readyToCheck =
    readable.length > 0 &&
    readable.every((file) => file.accountId !== "") &&
    readable.some((file) => file.parsed.status === "ok" && file.parsed.transactions.some((t) => keep(t.transactionDate)));
  const unreadableRows = files.reduce(
    (total, file) => total + (file.parsed.status === "ok" ? file.parsed.problems.length : 0),
    0,
  );

  // Only the parsed, cleaned-up transactions are sent — never the file itself.
  const payload = () =>
    readable.map((file) => ({
      fileName: file.name,
      accountId: file.accountId,
      // Per-row balances stay in the browser; only the latest one is sent.
      transactions:
        file.parsed.status === "ok"
          ? file.parsed.transactions
              .filter((t) => keep(t.transactionDate))
              .map((t) => ({ ...t, balance: undefined }))
          : [],
      latestBalance: file.parsed.status === "ok" ? file.parsed.latestBalance : null,
    }))
    .filter((file) => file.transactions.length > 0);

  async function chooseFiles(list: FileList | null) {
    if (!list) return;
    setError("");
    const chosen: ChosenFile[] = [...files];
    for (const file of Array.from(list)) {
      if (chosen.length >= MAX_FILES) {
        setError(`You can import up to ${MAX_FILES} files at a time.`);
        break;
      }
      if (chosen.some((existing) => existing.name === file.name)) continue;
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
      chosen.push({ name: file.name, parsed, accountId: suggestAccount(parsed, accounts) });
    }
    setFiles(chosen);
  }

  function updateFile(name: string, accountId: string) {
    setFiles((current) => current.map((file) => (file.name === name ? { ...file, accountId } : file)));
  }

  function startOver() {
    setFiles([]);
    setStep({ name: "choose" });
    setError("");
  }

  function check() {
    setError("");
    startTransition(async () => {
      const result = await previewImport(payload());
      if (result.ok) setStep({ name: "preview", files: result.files });
      else setError(result.error);
    });
  }

  function confirm() {
    setError("");
    startTransition(async () => {
      const result = await commitImport(payload());
      if (result.ok) setStep({ name: "done", result });
      else setError(result.error);
    });
  }

  if (step.name === "done") {
    const { result } = step;
    return (
      <section className={cardClass}>
        <h2 className="text-lg font-semibold">Import complete</h2>
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          <li>{plural(result.added, "transaction")} added</li>
          {result.matched > 0 && (
            <li>
              {result.matched} hand-added {result.matched === 1 ? "entry" : "entries"} matched and updated
            </li>
          )}
          <li>{plural(result.duplicatesSkipped, "duplicate")} skipped</li>
          {result.ai && result.ai.asked > 0 && (
            <li>
              {plural(result.ai.asked, "new merchant")} sorted by AI ({result.ai.confident} confidently)
            </li>
          )}
          <li>{plural(result.needReview, "transaction")} to look at in Sunday Review</li>
          {result.catchUp > 0 && <li>{plural(result.catchUp, "older transaction")} left for Catch-up</li>}
        </ul>
        {result.ai?.problem && (
          <div className="mt-3">
            <Notice>{result.ai.problem}</Notice>
          </div>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          {result.catchUp > 0 && (
            <Link href="/catch-up" className={primaryButton}>
              Go to Catch-up
            </Link>
          )}
          <Link href="/transactions?month=all" className={result.catchUp > 0 ? secondaryButton : primaryButton}>
            See transactions
          </Link>
          <button type="button" onClick={startOver} className={secondaryButton}>
            Import more
          </button>
        </div>
      </section>
    );
  }

  if (step.name === "preview") {
    const fresh = step.files.reduce((total, file) => total + file.fresh.length, 0);
    const duplicates = step.files.reduce((total, file) => total + file.duplicates.length, 0);
    const matched = step.files.reduce((total, file) => total + file.fresh.filter((row) => row.replaces).length, 0);
    return (
      <section className={cardClass}>
        <h2 className="text-lg font-semibold">Preview</h2>
        <p className="mt-1 text-sm text-muted">
          {plural(fresh + duplicates + unreadableRows, "transaction")} found
          {totalIgnored > 0 && `, plus ${plural(totalIgnored, "older one")} ignored`}. Nothing has been saved yet.
        </p>
        {matched > 0 && (
          <p className="mt-3 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
            {plural(matched, "transaction")} will replace entries you added by hand — no duplicates. They&apos;re marked
            below.
          </p>
        )}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Count label="new" value={fresh} />
          <Count label="already imported" value={duplicates} />
          <Count label="couldn't be read" value={unreadableRows} />
        </div>

        {step.files.map((file) => {
          const account = accounts.find((candidate) => candidate.id === file.accountId);
          return (
            <div key={file.fileName} className="mt-5 border-t border-line pt-4">
              <p className="text-sm font-medium">{file.fileName}</p>
              <p className="text-xs text-muted">Going into {account ? accountLabel(account) : "the chosen account"}</p>
              {file.fresh.length > 0 && (
                <details className="mt-3" open={step.files.length === 1}>
                  <summary className="cursor-pointer text-sm font-medium text-accent">
                    {plural(file.fresh.length, "new transaction")}
                  </summary>
                  <RowTable rows={file.fresh} />
                </details>
              )}
              {file.duplicates.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-accent">
                    {plural(file.duplicates.length, "duplicate")} that will be skipped
                  </summary>
                  <p className="mt-1 text-xs text-muted">
                    These match transactions that are already saved (same account, date, amount and description).
                  </p>
                  <RowTable rows={file.duplicates} />
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
        <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-line pt-4">
          <button type="button" onClick={() => setStep({ name: "choose" })} disabled={pending} className={secondaryButton}>
            Cancel
          </button>
          <button type="button" onClick={confirm} disabled={pending} className={primaryButton}>
            {pending ? "Importing…" : fresh === 0 ? "Nothing new — update existing" : `Import ${plural(fresh, "transaction")}`}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={cardClass}>
      <label className="mb-4 block">
        <span className="text-sm font-medium">Only import transactions on or after (optional)</span>
        <input
          type="date"
          value={ignoreBefore}
          onChange={(event) => setIgnoreBefore(event.target.value)}
          className="mt-1 block rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <span className="mt-1 block text-xs text-muted">
          Anything earlier in the files is left out, so your history starts on a clean date.
        </span>
      </label>
      <label className="block">
        <span className="text-sm font-medium">Choose files (CSV or Excel)</span>
        <input
          type="file"
          accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          multiple
          onChange={(event) => {
            void chooseFiles(event.target.files);
            event.target.value = "";
          }}
          className="mt-2 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-accent-soft file:px-4 file:py-2 file:text-sm file:font-semibold file:text-accent"
        />
      </label>

      {files.map((file) => (
        <div key={file.name} className="mt-4 border-t border-line pt-4">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-medium">{file.name}</p>
            <button
              type="button"
              onClick={() => setFiles((current) => current.filter((other) => other.name !== file.name))}
              className="shrink-0 text-xs font-medium text-muted hover:text-text"
            >
              Remove
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
                {file.parsed.problems.length > 0 &&
                  ` · ${plural(file.parsed.problems.length, "row")} couldn't be read`}
                {ignoredCount(file) > 0 && ` · ${plural(ignoredCount(file), "older one")} will be ignored`}
              </p>
              {file.parsed.sensitiveHeaders.length > 0 && (
                <p className="mt-2 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">
                  We detected sensitive fields in this file ({file.parsed.sensitiveHeaders.join(", ")}). These
                  fields will not be stored.
                </p>
              )}
              {file.parsed.problems.length > 0 && (
                <details className="mt-2 text-xs text-muted">
                  <summary className="cursor-pointer">Show rows that couldn&apos;t be read</summary>
                  <ul className="mt-1 list-disc pl-5">
                    {file.parsed.problems.slice(0, 20).map((problem) => (
                      <li key={problem.rowNumber}>
                        Line {problem.rowNumber}: {problem.problem}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {file.parsed.transactions.length > 0 && (
                <div className="mt-3">
                  <label className="text-xs font-medium text-muted">
                    Which account is this file from?
                    <select
                      value={file.accountId}
                      onChange={(event) => updateFile(file.name, event.target.value)}
                      className={`mt-1 ${controlClass}`}
                    >
                      <option value="">Choose an account…</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {accountLabel(account)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {addingFor === file.name ? (
                    <NewAccountForm
                      institution={file.parsed.institution}
                      accountType={file.parsed.accountTypes[0]}
                      people={people}
                      defaultOwnerId={currentUserId}
                      onCancel={() => setAddingFor(null)}
                      onAdded={(account) => {
                        setAccounts((current) => [...current, account]);
                        updateFile(file.name, account.id);
                        setAddingFor(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAddingFor(file.name)}
                      className="mt-2 text-xs font-medium text-accent hover:underline"
                    >
                      + Add a new account
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ))}

      {error && (
        <div className="mt-4">
          <Notice>{error}</Notice>
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-line pt-4">
          <button type="button" onClick={startOver} disabled={pending} className={secondaryButton}>
            Cancel
          </button>
          <button type="button" onClick={check} disabled={pending || !readyToCheck} className={primaryButton}>
            {pending ? "Checking…" : "Continue to preview"}
          </button>
        </div>
      )}
    </section>
  );
}
