"use server";

// Importing bank files happens in stages, each its own request:
//
//   previewImport  "Checking duplicates": what's new, what's already saved,
//                  which hand-added entries each new row might replace.
//   saveImport     "Saving transactions": replacements, new rows, balances,
//                  coverage. Idempotent: retrying with the same batch id never
//                  duplicates anything (see the import_batches migration).
//   sortImport     "Sorting merchants": the optional AI and the rules. If it
//                  fails, the transactions are still saved and it can simply
//                  be run again.
//
// The browser only ever sends cleaned rows (no account numbers, no per-row
// balances); every value is validated and rebuilt here.

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { applyRulesToWaiting } from "@/lib/categories/apply";
import { sortUnknownMerchantsWithAi } from "@/lib/categories/ai-sort";
import { settleSharedAccountFunding } from "@/lib/categories/maintenance";
import { catchUpFilter, getDataSource, requireHousehold, reviewQueueFilter, type HouseholdContext } from "@/lib/data";
import type { DataSource, TransactionFilter } from "@/lib/data/types";
import { MISSING_MIGRATION } from "@/lib/data/supabase";
import { addDays, formatDayWithYear, isISODate } from "@/lib/dates";
import { ACCOUNT_TYPES, type AccountRow, type AccountType, type TransactionRow, type TransactionType } from "@/lib/db/types";
import { accountCovers } from "@/lib/finance/coverage";
import { PRIVATE_LABEL, canKeepPrivate } from "@/lib/finance/privacy";
import { householdToday } from "@/lib/household-time";
import { decideMatches, mergeWithEntry, proposeMatches, type MatchDecision, type MatchStrength } from "@/lib/import/manual-match";
import { buildTransactions, splitDuplicates, validateImportInput, type NewTransaction } from "@/lib/import/prepare";
import { isUuid } from "@/lib/params";

const DEMO_MESSAGE = "This is the demo with made-up data, so nothing can be saved here.";
const GENERIC_PROBLEM = "Something went wrong. Please try again.";

export interface PreviewRow {
  /** the row's fingerprint: how later answers (privacy, matches) refer to it */
  key: string;
  date: string;
  merchant: string;
  description: string;
  amount: number;
  type: TransactionType;
  needsReview: boolean;
  /** one of your own purchases or refunds, so it can be kept private before saving */
  privateEligible: boolean;
  /** the hand-added entry this may replace */
  match?: {
    entryId: string;
    /** masked as "Private purchase" for a private entry */
    merchant: string;
    amount: number;
    date: string;
    strength: MatchStrength;
    isPrivate: boolean;
  };
}

export interface FilePreview {
  fileKey: string;
  fileName: string;
  accountId: string;
  fresh: PreviewRow[];
  duplicates: PreviewRow[];
}

export type PreviewResult = { ok: true; files: FilePreview[] } | { ok: false; error: string };

export interface SaveCounts {
  /** new transactions saved by this import (across every attempt) */
  added: number;
  /** hand-added entries replaced by their bank version */
  matched: number;
  /** rows already saved before, or repeated within the files */
  duplicatesSkipped: number;
  /** of the added ones, kept private */
  keptPrivate: number;
}

export type SaveResult =
  | ({ ok: true; batchId: string } & SaveCounts)
  | { ok: false; error: string; batchId?: string; savedSoFar?: number };

export interface SortCounts {
  /** waiting for a decision in Sunday Review, from this import */
  newDecisions: number;
  /** waiting in Sunday Review in total that you can see (this import and earlier ones) */
  allWaiting: number;
  /** older transactions from this import waiting on the Catch-up page */
  newCatchUp: number;
  /** everything waiting on the Catch-up page */
  allCatchUp: number;
}

export type SortResult =
  | ({ ok: true; ai: { asked: number; confident: number; problem?: string } | null } & SortCounts)
  | { ok: false; error: string };

export interface ImportRequest {
  /** chosen by the browser when the files are checked; reused for every retry */
  batchId: string;
  files: unknown;
  /** rows (by fingerprint) to keep private, with an optional reveal date */
  privateChoices?: unknown;
  /** answers to "Same purchase" / "Keep separate" */
  matchDecisions?: unknown;
}

export type AddAccountResult = { ok: true; account: AccountRow } | { ok: false; error: string };

function validDecisions(value: unknown): MatchDecision[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 500) return null;
  const decisions: MatchDecision[] = [];
  for (const item of value) {
    const { entryId, sourceHash, same } = (item ?? {}) as Record<string, unknown>;
    if (typeof entryId !== "string" || !isUuid(entryId)) return null;
    if (typeof sourceHash !== "string" || !/^[0-9a-f]{64}$/.test(sourceHash)) return null;
    if (typeof same !== "boolean") return null;
    decisions.push({ entryId, sourceHash, same });
  }
  return decisions;
}

function validPrivacy(value: unknown): Map<string, string | null> | null {
  if (value === undefined) return new Map();
  if (!Array.isArray(value) || value.length > 5000) return null;
  const choices = new Map<string, string | null>();
  for (const item of value) {
    const { sourceHash, until } = (item ?? {}) as Record<string, unknown>;
    if (typeof sourceHash !== "string" || !/^[0-9a-f]{64}$/.test(sourceHash)) return null;
    if (!(until === null || until === undefined || (typeof until === "string" && isISODate(until)))) return null;
    choices.set(sourceHash, (until as string | null | undefined) ?? null);
  }
  return choices;
}

/** Validated files, built rows, duplicates and match proposals. Shared by preview and save. */
async function prepare(request: ImportRequest, session: HouseholdContext) {
  const files = validateImportInput(request.files);
  if (!files) return { error: "We couldn't read those files. Please choose them again." } as const;
  if (typeof request.batchId !== "string" || !isUuid(request.batchId)) {
    return { error: "Please check the files again before importing." } as const;
  }
  const decisions = validDecisions(request.matchDecisions);
  const privacy = validPrivacy(request.privateChoices);
  if (!decisions || !privacy) return { error: "Please check the files again before importing." } as const;

  const data = getDataSource();
  const householdId = session.household.id;
  // Accounts come from the database for this household, never from the browser.
  const accounts = await data.listAccounts(householdId);
  if (files.some((file) => !accounts.some((account) => account.id === file.accountId && account.is_active))) {
    return { error: "One of the chosen accounts no longer exists. Please pick again." } as const;
  }

  const [rules, categories] = await Promise.all([data.listRules(householdId), data.listCategories(householdId)]);
  const members = session.members.map((member) => ({ id: member.id, name: member.name }));
  // Rows per file, tagged with this import.
  const built = files.map((file) =>
    buildTransactions([file], accounts, members, rules, categories).map((row) => ({ ...row, import_batch_id: request.batchId })),
  );
  const all = built.flat();
  const fileOf = new Map<NewTransaction, number>();
  built.forEach((rows, index) => rows.forEach((row) => fileOf.set(row, index)));

  const existing: string[] = [];
  for (const accountId of new Set(all.map((row) => row.account_id))) {
    const dates = all.filter((row) => row.account_id === accountId).map((row) => row.transaction_date);
    const from = dates.reduce((a, b) => (a < b ? a : b));
    const to = dates.reduce((a, b) => (a > b ? a : b));
    existing.push(...(await data.listSourceHashes(householdId, accountId, from, to)));
  }
  const { fresh, duplicates } = splitDuplicates(all, existing);

  // Your own purchases you chose to keep private: applied before anything is
  // saved, so they never reach the AI or teach a rule.
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  for (const row of fresh) {
    if (!privacy.has(row.source_hash)) continue;
    const until = privacy.get(row.source_hash) ?? null;
    if (!canKeepPrivate(row, session.user.id) || accountsById.get(row.account_id)?.owner_user_id !== session.user.id) {
      return { error: "Only your own purchases, on your own accounts, can be kept private." } as const;
    }
    if (until !== null && until <= householdToday(session.household)) {
      return { error: "Choose a reveal date after today, or leave it blank." } as const;
    }
    row.is_private = true;
    row.private_until = until;
  }

  // Hand-added entries waiting for their bank version (only ones you can see).
  const waiting = (await data.listTransactions(householdId, { awaitingPost: true })).rows;
  return { files, data, accounts, fresh, duplicates, fileOf, waiting, decisions } as const;
}

function toPreviewRow(row: NewTransaction, userId: string, entry?: TransactionRow, strength?: MatchStrength): PreviewRow {
  return {
    key: row.source_hash,
    date: row.transaction_date,
    merchant: row.normalized_merchant,
    description: row.original_description,
    amount: row.amount,
    type: row.transaction_type,
    needsReview: row.review_status === "needs_review",
    privateEligible: canKeepPrivate(row, userId),
    ...(entry && strength
      ? {
          match: {
            entryId: entry.id,
            // Masked like everywhere else private purchases are listed, in case the screen is shared.
            merchant: entry.is_private ? PRIVATE_LABEL : entry.normalized_merchant,
            amount: entry.amount,
            date: entry.transaction_date,
            strength,
            isPrivate: entry.is_private,
          },
        }
      : {}),
  };
}

export async function previewImport(request: ImportRequest): Promise<PreviewResult> {
  try {
    const session = await requireHousehold();
    const prepared = await prepare(request, session);
    if ("error" in prepared) return { ok: false, error: prepared.error ?? GENERIC_PROBLEM };
    const entries = new Map(prepared.waiting.map((entry) => [entry.id, entry]));
    const proposals = new Map(
      proposeMatches(prepared.waiting, prepared.fresh).map((proposal) => [prepared.fresh[proposal.index], proposal]),
    );
    const rowsOf = (rows: NewTransaction[], index: number) => rows.filter((row) => prepared.fileOf.get(row) === index);
    return {
      ok: true,
      files: prepared.files.map((file, index) => ({
        fileKey: file.fileKey ?? `file-${index}`,
        fileName: file.fileName,
        accountId: file.accountId,
        fresh: rowsOf(prepared.fresh, index).map((row) => {
          const proposal = proposals.get(row);
          return toPreviewRow(row, session.user.id, proposal && entries.get(proposal.entryId), proposal?.strength);
        }),
        duplicates: rowsOf(prepared.duplicates, index).map((row) => toPreviewRow(row, session.user.id)),
      })),
    };
  } catch (error) {
    unstable_rethrow(error); // let sign-in redirects through
    console.error("previewImport failed", error instanceof Error ? error.message : error);
    return { ok: false, error: GENERIC_PROBLEM };
  }
}

async function countRows(data: DataSource, householdId: string, filter: TransactionFilter | null): Promise<number> {
  return filter ? (await data.listTransactions(householdId, filter, { limit: 1, offset: 0 })).total : 0;
}

export async function saveImport(request: ImportRequest): Promise<SaveResult> {
  let batchId: string | undefined;
  let session: HouseholdContext | undefined;
  try {
    session = await requireHousehold();
    if (session.isDemo) return { ok: false, error: DEMO_MESSAGE };
    const prepared = await prepare(request, session);
    if ("error" in prepared) return { ok: false, error: prepared.error ?? GENERIC_PROBLEM };
    const { data, files, fresh, duplicates, waiting, decisions } = prepared;
    const householdId = session.household.id;

    const batch = await data.startImportBatch(householdId, { id: request.batchId, file_count: files.length });
    batchId = batch.id;

    // A bank row the person agreed matches a hand-added entry replaces it
    // (only while the entry is still waiting, so a retry can't do it twice).
    const entries = new Map(waiting.map((entry) => [entry.id, entry]));
    const replacements = decideMatches(waiting, fresh, decisions);
    const replaced = new Set<NewTransaction>();
    for (const [index, entryId] of replacements) {
      const row = fresh[index];
      const entry = entries.get(entryId)!;
      if (await data.replaceManualEntry(householdId, entry.id, mergeWithEntry(entry, row))) replaced.add(row);
    }
    // Everything else is new; fingerprints already saved (by an earlier attempt or anyone else) are skipped.
    await data.insertTransactions(fresh.filter((row) => !replaced.has(row)));

    // Checking accounts' latest balances, from the running-balance column.
    for (const file of files) {
      if (file.latestBalance) {
        await data.recordImportedBalance(householdId, {
          account_id: file.accountId,
          as_of: file.latestBalance.date,
          balance: file.latestBalance.balance,
        });
      }
    }
    // What each file covers: from its first row through the date the person confirmed.
    const coverage = await data.listCoverage(householdId);
    for (const file of files) {
      if (!file.coveredThrough || file.transactions.length === 0) continue;
      const from = file.transactions.reduce((min, t) => (t.transactionDate < min ? t.transactionDate : min), file.coveredThrough);
      if (accountCovers(coverage, file.accountId, from, file.coveredThrough)) continue;
      await data.recordCoverage(householdId, {
        account_id: file.accountId,
        covered_from: from,
        covered_through: file.coveredThrough,
        source: "import",
      });
    }
    // Re-importing a file fills in the bank's category on rows saved before that was kept.
    await data.fillBankCategories(householdId, duplicates);
    await settleSharedAccountFunding(data, householdId);

    const matched = batch.matched + replaced.size;
    const savedRows = (await data.listTransactions(householdId, { importBatchId: batch.id })).rows;
    const added = Math.max(0, savedRows.length - matched);
    await data.updateImportBatch(householdId, batch.id, {
      status: batch.status === "sorted" ? "sorted" : "saved",
      matched,
      duplicates: Math.max(0, fresh.length + duplicates.length - added - matched),
    });
    revalidatePath("/", "layout");
    return {
      ok: true,
      batchId: batch.id,
      added,
      matched,
      duplicatesSkipped: Math.max(0, fresh.length + duplicates.length - added - matched),
      keptPrivate: savedRows.filter((row) => row.is_private).length,
    };
  } catch (error) {
    unstable_rethrow(error); // let sign-in redirects through
    console.error("saveImport failed", error instanceof Error ? error.message : error);
    if (error instanceof Error && error.message === MISSING_MIGRATION) return { ok: false, error: MISSING_MIGRATION };
    let savedSoFar: number | undefined;
    if (batchId && session) {
      savedSoFar = await countRows(getDataSource(), session.household.id, { importBatchId: batchId }).catch(() => undefined);
    }
    return {
      ok: false,
      batchId,
      savedSoFar,
      error:
        savedSoFar && savedSoFar > 0
          ? `${savedSoFar} ${savedSoFar === 1 ? "transaction was" : "transactions were"} saved before something went wrong. Try again to finish — nothing will be saved twice.`
          : "Nothing was saved. Please try again.",
    };
  }
}

/** The second stage: AI suggestions for unfamiliar merchants (optional), then the rules. */
export async function sortImport(input: { batchId: string }): Promise<SortResult> {
  try {
    const session = await requireHousehold();
    if (session.isDemo) return { ok: false, error: DEMO_MESSAGE };
    if (typeof input?.batchId !== "string" || !isUuid(input.batchId)) return { ok: false, error: GENERIC_PROBLEM };
    const data = getDataSource();
    const household = session.household;
    const batch = await data.getImportBatch(household.id, input.batchId);
    if (!batch) return { ok: false, error: "That import can't be found. Your saved transactions are unaffected." };

    // Merchants no rule knows go to the AI once; its answers become rules.
    // Private purchases are never sent. If it can't be reached, that's fine.
    let ai: Extract<SortResult, { ok: true }>["ai"] = null;
    try {
      const result = await sortUnknownMerchantsWithAi(data, household.id);
      if (result.asked > 0) ai = { asked: result.asked, confident: result.confident };
    } catch (error) {
      console.error("AI sorting failed", error instanceof Error ? error.message : error);
      ai = { asked: 0, confident: 0, problem: "The AI couldn't be reached, so unfamiliar merchants were left for you to sort." };
    }
    await applyRulesToWaiting(data, household.id, household.review_starts_on);
    await data.updateImportBatch(household.id, batch.id, { status: "sorted", sort_problem: ai?.problem ?? null });
    revalidatePath("/", "layout");

    const review = reviewQueueFilter(household);
    const catchUp = catchUpFilter(household);
    return {
      ok: true,
      ai,
      newDecisions: await countRows(data, household.id, { ...review, importBatchId: batch.id }),
      allWaiting: await countRows(data, household.id, review),
      newCatchUp: catchUp ? await countRows(data, household.id, { ...catchUp, importBatchId: batch.id }) : 0,
      allCatchUp: await countRows(data, household.id, catchUp),
    };
  } catch (error) {
    unstable_rethrow(error);
    console.error("sortImport failed", error instanceof Error ? error.message : error);
    return {
      ok: false,
      error: "Your transactions are saved. Sorting them didn't finish — try again, or sort them yourself in Sunday Review.",
    };
  }
}

/** For the Import page: your last import, if it stopped before sorting finished. */
export async function unfinishedImportSummary(): Promise<{ batchId: string; saved: number; status: "saving" | "saved" } | null> {
  const session = await requireHousehold();
  const data = getDataSource();
  const batch = await data.unfinishedImport(session.household.id);
  if (!batch || batch.status === "sorted") return null;
  const saved = await countRows(data, session.household.id, { importBatchId: batch.id });
  return { batchId: batch.id, saved, status: batch.status };
}

export async function addAccount(input: {
  institution: string;
  accountName: string;
  accountType: string;
  ownerId: string;
  lastFour: string;
}): Promise<AddAccountResult> {
  try {
    const session = await requireHousehold();
    if (session.isDemo) return { ok: false, error: DEMO_MESSAGE };

    const institution = String(input.institution ?? "").trim().slice(0, 60);
    const accountName = String(input.accountName ?? "").trim().slice(0, 60);
    const lastFour = String(input.lastFour ?? "").trim();
    const ownerId = String(input.ownerId ?? "");
    if (!institution || !accountName) return { ok: false, error: "Enter the bank and a name for the account." };
    if (!ACCOUNT_TYPES.includes(input.accountType as AccountType)) {
      return { ok: false, error: "Choose what kind of account this is." };
    }
    if (lastFour && !/^\d{4}$/.test(lastFour)) {
      return { ok: false, error: "Last four digits must be exactly four numbers, or left blank." };
    }
    const isMember = isUuid(ownerId) && session.members.some((member) => member.id === ownerId);
    if (ownerId !== "" && !isMember) return { ok: false, error: "Choose whose account this is." };

    const account = await getDataSource().createAccount(session.household.id, {
      institution,
      account_name: accountName,
      account_type: input.accountType as AccountType,
      owner_user_id: ownerId || null,
      last_four: lastFour || null,
    });
    revalidatePath("/", "layout");
    return { ok: true, account };
  } catch (error) {
    unstable_rethrow(error); // let sign-in redirects through
    console.error("addAccount failed", error instanceof Error ? error.message : error);
    return { ok: false, error: GENERIC_PROBLEM };
  }
}

/**
 * "Nothing new on this account through <date>": extends an account's coverage
 * without importing (for an account with no activity), confirmed by a person.
 */
export async function confirmCoverage(input: { accountId: string; through: string }) {
  try {
    const session = await requireHousehold();
    if (session.isDemo) return { ok: false as const, error: DEMO_MESSAGE };
    const data = getDataSource();
    const through = String(input.through ?? "");
    if (!isISODate(through) || through > householdToday(session.household)) {
      return { ok: false as const, error: "Choose a date that isn't in the future." };
    }
    const [accounts, coverage] = await Promise.all([data.listAccounts(session.household.id), data.listCoverage(session.household.id)]);
    const account = accounts.find((candidate) => candidate.id === input.accountId && candidate.is_active);
    if (!account) return { ok: false as const, error: "That account no longer exists." };
    const own = coverage.filter((period) => period.account_id === account.id);
    const lastThrough = own.reduce<string | null>((max, period) => (!max || period.covered_through > max ? period.covered_through : max), null);
    if (lastThrough && through <= lastThrough) return { ok: true as const, message: "Already covered through that date." };
    const from = lastThrough ? addDays(lastThrough, 1) : through;
    await data.recordCoverage(session.household.id, { account_id: account.id, covered_from: from, covered_through: through, source: "confirmed" });
    revalidatePath("/", "layout");
    return { ok: true as const, message: `Marked complete through ${formatDayWithYear(through)}.` };
  } catch (error) {
    unstable_rethrow(error);
    console.error("confirmCoverage failed", error instanceof Error ? error.message : error);
    const needsUpdate = error instanceof Error && error.message === MISSING_MIGRATION;
    return { ok: false as const, error: needsUpdate ? MISSING_MIGRATION : GENERIC_PROBLEM };
  }
}
