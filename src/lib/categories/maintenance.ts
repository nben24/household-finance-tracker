import "server-only";
import type { DataSource, Member, TransactionChanges } from "@/lib/data/types";
import type { HouseholdRow } from "@/lib/db/types";
import { classifyTransaction } from "@/lib/import/classify";
import { normalizeMerchant, paymentAppPerson } from "@/lib/import/merchant";
import { findKnownMerchant } from "@/lib/import/merchant-library";
import {
  attributeSharedDeposits,
  isSharedAccount,
  matchMemberZelles,
  matchPassThroughPaybacks,
  matchSharedAccountFunding,
  pendingSharedFunding,
} from "@/lib/finance/shared-account";
import { applyRulesToWaiting } from "./apply";

/**
 * Matches money moving between the two of you and the joint account, so it's
 * never counted as spending:
 * 1. unnamed deposits into the joint account are credited to whoever sent them
 * 2. withdrawals that funded the joint account become transfers
 * 3. Zelles from one person's account to the other's become paybacks
 * 4. money one person sent the other through the joint account becomes a payback
 * 5. deposits the joint account's statement doesn't show yet count as paid in
 *    for now (see pendingSharedFunding)
 * Returns how many transactions changed.
 */
export async function settleSharedAccountFunding(data: DataSource, householdId: string): Promise<number> {
  const accounts = new Map((await data.listAccounts(householdId)).map((account) => [account.id, account]));
  let changed = 0;

  let rows = (await data.listTransactions(householdId)).rows;
  for (const { row, counterpartyId } of attributeSharedDeposits(rows, accounts)) {
    await data.updateTransactions(householdId, [row.id], { counterparty_id: counterpartyId });
    changed += 1;
  }

  rows = (await data.listTransactions(householdId)).rows;
  const funding = matchSharedAccountFunding(rows, accounts).filter(
    (row) =>
      row.transaction_type !== "transfer" || row.review_status !== "auto_categorized" || row.counterparty_id !== null,
  );
  if (funding.length > 0) {
    await data.updateTransactions(
      householdId,
      funding.map((row) => row.id),
      {
        transaction_type: "transfer",
        counterparty_id: null,
        category_id: null,
        subcategory_id: null,
        expense_type: null,
        review_status: "auto_categorized",
        categorization_confidence: "high",
        categorization_reason: "Matches a deposit into the shared account",
      },
    );
    changed += funding.length;
  }

  rows = (await data.listTransactions(householdId)).rows;
  for (const { row, counterpartyId } of matchMemberZelles(rows, accounts)) {
    await data.updateTransactions(householdId, [row.id], {
      transaction_type: "reimbursement",
      counterparty_id: counterpartyId,
      category_id: null,
      subcategory_id: null,
      expense_type: null,
      review_status: "auto_categorized",
      categorization_confidence: "high",
      categorization_reason: "Matches a Zelle into the other person's account",
    });
    changed += 1;
  }

  rows = (await data.listTransactions(householdId)).rows;
  for (const { row, counterpartyId } of matchPassThroughPaybacks(rows, accounts)) {
    await data.updateTransactions(householdId, [row.id], {
      transaction_type: "reimbursement",
      counterparty_id: counterpartyId,
      category_id: null,
      subcategory_id: null,
      expense_type: null,
      review_status: "auto_categorized",
      categorization_confidence: "high",
      categorization_reason: "Sent by the other person through the joint account",
    });
    changed += 1;
  }

  rows = (await data.listTransactions(householdId)).rows;
  const { pending, notPending } = pendingSharedFunding(rows, accounts);
  for (const row of pending) {
    await data.updateTransactions(householdId, [row.id], {
      transaction_type: "transfer",
      counterparty_id: row.person_id,
      category_id: null,
      subcategory_id: null,
      expense_type: null,
      review_status: "auto_categorized",
      categorization_confidence: "medium",
      categorization_reason: "Your usual deposit into the shared account; the joint account's statement doesn't show it yet",
    });
    changed += 1;
  }
  if (notPending.length > 0) {
    await data.updateTransactions(
      householdId,
      notPending.map((row) => row.id),
      {
        counterparty_id: null,
        review_status: "needs_review",
        categorization_confidence: "low",
        categorization_reason: "Looked like a deposit into the shared account, but the joint account doesn't show one",
      },
    );
    changed += notPending.length;
  }
  return changed;
}

/**
 * Brings transactions imported by an earlier version up to date: payment-app
 * names, who paid into the shared account, shared-account pairing, and rules.
 * Never changes a decision someone made in review, except to fill in blanks.
 */
export async function recheckTransactions(data: DataSource, household: HouseholdRow, members: Member[]) {
  const householdId = household.id;
  const [accounts, all] = await Promise.all([data.listAccounts(householdId), data.listTransactions(householdId)]);
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const people = members.map((member) => ({ id: member.id, name: member.name }));
  let renamed = 0;
  let contributors = 0;
  let retyped = 0;

  for (const row of all.rows) {
    const changes: TransactionChanges = {};
    // Refresh names from the (growing) list of known merchants; leave
    // unrecognized names alone, since they may have been learned from.
    const known = findKnownMerchant(row.original_description);
    const payment = paymentAppPerson(row.original_description);
    if (known || payment) {
      const merchant = normalizeMerchant(row.original_description);
      if (merchant !== row.normalized_merchant) {
        changes.normalized_merchant = merchant;
        renamed += 1;
      }
    }
    const account = accountsById.get(row.account_id);
    if (row.transaction_type === "transfer" && row.amount > 0 && !row.counterparty_id && isSharedAccount(account)) {
      const classification = classifyTransaction(
        { originalDescription: row.original_description, amount: row.amount, transactionTypeHint: null },
        account!.account_type,
        { ownerId: null, members: people },
      );
      if (classification.type === "transfer" && classification.counterpartyId) {
        changes.counterparty_id = classification.counterpartyId;
        contributors += 1;
      }
    }
    // Spending that turns out to be investing or a transfer by today's rules
    // (e.g. a brokerage the app didn't know before), and "card payments" that
    // were really moves to savings. Never overrides a person's choice.
    const retypable = row.transaction_type === "expense" || row.transaction_type === "credit_card_payment";
    if (retypable && row.review_status !== "reviewed" && account) {
      const classification = classifyTransaction(
        {
          originalDescription: row.original_description,
          amount: row.amount,
          transactionTypeHint: null,
          bankCategory: row.bank_category,
        },
        account.account_type,
        { ownerId: account.owner_user_id, members: people },
      );
      const better =
        row.transaction_type === "expense"
          ? classification.type !== "expense"
          : classification.type === "transfer";
      if (better && classification.confidence === "high") {
        Object.assign(changes, {
          transaction_type: classification.type,
          category_id: null,
          subcategory_id: null,
          expense_type: null,
          review_status: "auto_categorized",
          categorization_confidence: "high",
          categorization_reason: classification.reason,
        } satisfies TransactionChanges);
        retyped += 1;
      }
    }
    if (Object.keys(changes).length > 0) await data.updateTransactions(householdId, [row.id], changes);
  }

  const paired = await settleSharedAccountFunding(data, householdId);
  const sorted = await applyRulesToWaiting(data, householdId, household.review_starts_on);
  return { renamed, contributors, retyped, paired, sorted };
}
