"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { applyRulesToWaiting } from "@/lib/categories/apply";
import { sortUnknownMerchantsWithAi } from "@/lib/categories/ai-sort";
import { settleSharedAccountFunding } from "@/lib/categories/maintenance";
import { catchUpFilter, getDataSource, requireHousehold, reviewQueueFilter } from "@/lib/data";
import type { TransactionFilter } from "@/lib/data/types";
import { MISSING_MIGRATION } from "@/lib/data/supabase";
import {
  ACCOUNT_TYPES,
  type AccountRow,
  type AccountType,
  type TransactionRow,
  type TransactionType,
} from "@/lib/db/types";
import { matchManualEntries, mergeWithEntry } from "@/lib/import/manual-match";
import {
  buildTransactions,
  splitDuplicates,
  validateImportInput,
  type NewTransaction,
} from "@/lib/import/prepare";
import { isUuid } from "@/lib/params";

const DEMO_MESSAGE = "This is the demo with made-up data, so nothing can be saved here.";
const GENERIC_PROBLEM = "Something went wrong. Please try again.";

export interface PreviewRow {
  date: string;
  merchant: string;
  description: string;
  amount: number;
  type: TransactionType;
  needsReview: boolean;
  /** the hand-added entry this replaces, if any */
  replaces?: { merchant: string; amount: number; date: string };
}

export interface FilePreview {
  fileName: string;
  accountId: string;
  fresh: PreviewRow[];
  duplicates: PreviewRow[];
}

export type PreviewResult = { ok: true; files: FilePreview[] } | { ok: false; error: string };
export type CommitResult =
  | {
      ok: true;
      added: number;
      /** hand-added entries replaced by their bank version */
      matched: number;
      duplicatesSkipped: number;
      /** waiting in Sunday Review */
      needReview: number;
      /** waiting on the Catch-up page (history) */
      catchUp: number;
      ai: { asked: number; confident: number; problem?: string } | null;
    }
  | { ok: false; error: string };
export type AddAccountResult = { ok: true; account: AccountRow } | { ok: false; error: string };

function toPreviewRow(row: NewTransaction, replaces?: TransactionRow): PreviewRow {
  return {
    date: row.transaction_date,
    merchant: row.normalized_merchant,
    description: row.original_description,
    amount: row.amount,
    type: row.transaction_type,
    needsReview: row.review_status === "needs_review",
    ...(replaces
      ? { replaces: { merchant: replaces.normalized_merchant, amount: replaces.amount, date: replaces.transaction_date } }
      : {}),
  };
}

/** Shared by preview and commit so both see exactly the same result. */
async function prepare(input: unknown) {
  const session = await requireHousehold();
  const files = validateImportInput(input);
  if (!files) return { error: "We couldn't read those files. Please choose them again." } as const;

  const data = getDataSource();
  const householdId = session.household.id;
  // Accounts come from the database for this household, never from the browser.
  const accounts = await data.listAccounts(householdId);
  if (files.some((file) => !accounts.some((account) => account.id === file.accountId))) {
    return { error: "One of the chosen accounts no longer exists. Please pick again." } as const;
  }

  const [rules, categories] = await Promise.all([
    data.listRules(householdId),
    data.listCategories(householdId),
  ]);
  const rows = buildTransactions(
    files,
    accounts,
    session.members.map((member) => ({ id: member.id, name: member.name })),
    rules,
    categories,
  );

  const existing: string[] = [];
  for (const accountId of new Set(rows.map((row) => row.account_id))) {
    const dates = rows.filter((row) => row.account_id === accountId).map((row) => row.transaction_date);
    const from = dates.reduce((a, b) => (a < b ? a : b));
    const to = dates.reduce((a, b) => (a > b ? a : b));
    existing.push(...(await data.listSourceHashes(householdId, accountId, from, to)));
  }

  const split = splitDuplicates(rows, existing);
  // Hand-added entries waiting for their bank version.
  const waiting = (await data.listTransactions(householdId, { awaitingPost: true })).rows;
  const matches = matchManualEntries(waiting, split.fresh);
  const entriesById = new Map(waiting.map((entry) => [entry.id, entry]));
  const replacing = new Map(
    [...matches].map(([index, id]) => [split.fresh[index], entriesById.get(id)!] as const),
  );
  return { session, files, data, ...split, replacing } as const;
}

export async function previewImport(input: unknown): Promise<PreviewResult> {
  try {
    const prepared = await prepare(input);
    if ("error" in prepared) return { ok: false, error: prepared.error ?? GENERIC_PROBLEM };
    return {
      ok: true,
      files: prepared.files.map((file) => ({
        fileName: file.fileName,
        accountId: file.accountId,
        fresh: prepared.fresh
          .filter((row) => row.account_id === file.accountId && row.source_file === file.fileName)
          .map((row) => toPreviewRow(row, prepared.replacing.get(row))),
        duplicates: prepared.duplicates
          .filter((row) => row.account_id === file.accountId && row.source_file === file.fileName)
          .map((row) => toPreviewRow(row)),
      })),
    };
  } catch (error) {
    unstable_rethrow(error); // let sign-in redirects through
    console.error("previewImport failed", error instanceof Error ? error.message : error);
    return { ok: false, error: GENERIC_PROBLEM };
  }
}

export async function commitImport(input: unknown): Promise<CommitResult> {
  try {
    const prepared = await prepare(input);
    if ("error" in prepared) return { ok: false, error: prepared.error ?? GENERIC_PROBLEM };
    if (prepared.session.isDemo) return { ok: false, error: DEMO_MESSAGE };

    const household = prepared.session.household;
    // A bank row that matches a hand-added entry replaces it; the rest are new.
    for (const [row, entry] of prepared.replacing) {
      await prepared.data.replaceManualEntry(household.id, entry.id, mergeWithEntry(entry, row));
    }
    const added = await prepared.data.insertTransactions(prepared.fresh.filter((row) => !prepared.replacing.has(row)));
    // Checking accounts' latest balances, from the running-balance column.
    for (const file of prepared.files) {
      if (file.latestBalance) {
        await prepared.data.recordImportedBalance(household.id, {
          account_id: file.accountId,
          as_of: file.latestBalance.date,
          balance: file.latestBalance.balance,
        });
      }
    }
    // Re-importing a file fills in the bank's category on rows saved before
    // that was kept.
    await prepared.data.fillBankCategories(household.id, prepared.duplicates);
    await settleSharedAccountFunding(prepared.data, household.id);
    // Merchants no rule knows go to the AI once; its answers become rules.
    let ai: Extract<CommitResult, { ok: true }>["ai"] = null;
    try {
      const result = await sortUnknownMerchantsWithAi(prepared.data, household.id);
      if (result.asked > 0) ai = { asked: result.asked, confident: result.confident };
    } catch (error) {
      console.error("AI sorting failed", error instanceof Error ? error.message : error);
      ai = { asked: 0, confident: 0, problem: "The AI couldn't be reached, so unknown merchants were left for you." };
    }
    await applyRulesToWaiting(prepared.data, household.id, household.review_starts_on);
    revalidatePath("/", "layout");

    const count = async (filter: TransactionFilter | null) =>
      filter ? (await prepared.data.listTransactions(household.id, filter, { limit: 1, offset: 0 })).total : 0;
    return {
      ok: true,
      added,
      matched: prepared.replacing.size,
      // includes any that another upload saved between preview and confirm
      duplicatesSkipped: prepared.duplicates.length + (prepared.fresh.length - prepared.replacing.size - added),
      needReview: await count(reviewQueueFilter(household)),
      catchUp: await count(catchUpFilter(household)),
      ai,
    };
  } catch (error) {
    unstable_rethrow(error); // let sign-in redirects through
    console.error("commitImport failed", error instanceof Error ? error.message : error);
    const needsUpdate = error instanceof Error && error.message === MISSING_MIGRATION;
    return { ok: false, error: needsUpdate ? MISSING_MIGRATION : GENERIC_PROBLEM };
  }
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
