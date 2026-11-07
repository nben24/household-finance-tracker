// Money paid into the joint ("shared") account by each person.
//
// The deposit row on the joint account is the record of who paid in
// (counterparty_id). The matching withdrawal from the person's own account can
// look like a payment to the other person (some banks show a Zelle into a joint
// account under the joint account holder's name), so it is paired with the
// deposit and treated as a transfer rather than a payback.

import { addDays, daysBetween } from "@/lib/dates";
import type { AccountRow, TransactionRow } from "@/lib/db/types";
import { toCents } from "@/lib/money";

const MATCH_WINDOW_DAYS = 4;

type Row = Pick<
  TransactionRow,
  | "id"
  | "original_description"
  | "account_id"
  | "person_id"
  | "counterparty_id"
  | "amount"
  | "transaction_date"
  | "transaction_type"
  | "review_status"
> &
  Partial<Pick<TransactionRow, "normalized_merchant">>;

export function isSharedAccount(account: Pick<AccountRow, "owner_user_id"> | undefined): boolean {
  return account !== undefined && account.owner_user_id === null;
}

/** Deposits into a shared account that someone in the household paid in. */
export function sharedDeposits<T extends Row>(rows: T[], accounts: Map<string, Pick<AccountRow, "owner_user_id">>): T[] {
  return rows.filter(
    (row) =>
      row.transaction_type === "transfer" &&
      row.amount > 0 &&
      row.counterparty_id !== null &&
      isSharedAccount(accounts.get(row.account_id)),
  );
}

/**
 * Withdrawals from a person's own account that match a deposit into a shared
 * account from that same person: same amount, within a few days. Rows a person
 * already decided in review are never changed. Each deposit pairs with at most
 * one withdrawal.
 */
export function matchSharedAccountFunding<T extends Row>(
  rows: T[],
  accounts: Map<string, Pick<AccountRow, "owner_user_id">>,
  { includeReviewed = false }: { includeReviewed?: boolean } = {},
): T[] {
  const deposits = sharedDeposits(rows, accounts);
  const used = new Set<string>();
  const matched: T[] = [];
  const candidates = rows
    .filter(
      (row) =>
        (includeReviewed || row.review_status !== "reviewed") &&
        row.amount < 0 &&
        row.person_id !== null &&
        (row.transaction_type === "reimbursement" || row.transaction_type === "transfer") &&
        !isSharedAccount(accounts.get(row.account_id)),
    )
    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));

  for (const withdrawal of candidates) {
    const deposit = deposits
      .filter(
        (row) =>
          !used.has(row.id) &&
          row.counterparty_id === withdrawal.person_id &&
          toCents(row.amount) === -toCents(withdrawal.amount) &&
          Math.abs(daysBetween(withdrawal.transaction_date, row.transaction_date)) <= MATCH_WINDOW_DAYS,
      )
      .sort(
        (a, b) =>
          Math.abs(daysBetween(withdrawal.transaction_date, a.transaction_date)) -
          Math.abs(daysBetween(withdrawal.transaction_date, b.transaction_date)),
      )[0];
    if (deposit) {
      used.add(deposit.id);
      matched.push(withdrawal);
    }
  }
  return matched;
}

const PAYMENT_APP = /ZELLE|VENMO/i;
const MEMBER_MATCH_DAYS = 3;
/** A deposit that leaves the joint account again this soon was passed through, not contributed. */
const PASS_THROUGH_DAYS = 5;

function closestFirst<T extends Row>(from: string, rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => Math.abs(daysBetween(from, a.transaction_date)) - Math.abs(daysBetween(from, b.transaction_date)),
  );
}

/**
 * Zelles between the two of you, recognized from both sides even when the
 * sender's contact name for the other person isn't their real first name
 * (e.g. a nickname): money out of one person's own account that matches money
 * into the other person's own account (same amount, within a few days).
 * Returns the outgoing row with the person it went to.
 */
export function matchMemberZelles<T extends Row>(
  rows: T[],
  accounts: Map<string, Pick<AccountRow, "owner_user_id">>,
): { row: T; counterpartyId: string }[] {
  const ownerOf = (row: Row) => accounts.get(row.account_id)?.owner_user_id ?? null;
  const incoming = rows.filter(
    (row) =>
      row.amount > 0 &&
      ownerOf(row) !== null &&
      PAYMENT_APP.test(row.original_description) &&
      ["reimbursement", "income", "transfer"].includes(row.transaction_type),
  );
  const used = new Set<string>();
  const matched: { row: T; counterpartyId: string }[] = [];
  const outgoing = rows
    .filter(
      (row) =>
        row.amount < 0 &&
        row.review_status !== "reviewed" &&
        ownerOf(row) !== null &&
        PAYMENT_APP.test(row.original_description) &&
        (row.transaction_type === "expense" || row.transaction_type === "reimbursement"),
    )
    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));

  for (const out of outgoing) {
    const sender = ownerOf(out);
    const receipt = closestFirst(
      out.transaction_date,
      incoming.filter(
        (row) =>
          !used.has(row.id) &&
          ownerOf(row) !== sender &&
          toCents(row.amount) === -toCents(out.amount) &&
          Math.abs(daysBetween(out.transaction_date, row.transaction_date)) <= MEMBER_MATCH_DAYS,
      ),
    )[0];
    if (receipt) {
      used.add(receipt.id);
      // Already recorded correctly? Then there's nothing to change.
      if (out.transaction_type !== "reimbursement" || out.counterparty_id !== ownerOf(receipt)) {
        matched.push({ row: out, counterpartyId: ownerOf(receipt)! });
      }
    }
  }
  return matched;
}

/**
 * Deposits into the joint account whose description doesn't name anyone
 * (e.g. "Online Banking transfer from CHK 0000"), credited to the person whose
 * own account the money came from: a withdrawal of the same amount within a
 * few days. Money that leaves the joint account again right away (passed
 * through, like a share of a bill forwarded to the other person) is not a
 * contribution and isn't credited.
 */
export function attributeSharedDeposits<T extends Row>(
  rows: T[],
  accounts: Map<string, Pick<AccountRow, "owner_user_id">>,
): { row: T; counterpartyId: string }[] {
  const ownerOf = (row: Row) => accounts.get(row.account_id)?.owner_user_id ?? null;
  const shared = (row: Row) => isSharedAccount(accounts.get(row.account_id));
  const used = new Set<string>();
  const result: { row: T; counterpartyId: string }[] = [];
  const deposits = rows.filter(
    (row) => shared(row) && row.amount > 0 && row.transaction_type === "transfer" && row.counterparty_id === null,
  );
  for (const deposit of deposits) {
    const passedThrough = rows.some(
      (row) =>
        row.account_id === deposit.account_id &&
        row.amount < 0 &&
        toCents(row.amount) === -toCents(deposit.amount) &&
        daysBetween(deposit.transaction_date, row.transaction_date) >= 0 &&
        daysBetween(deposit.transaction_date, row.transaction_date) <= PASS_THROUGH_DAYS,
    );
    if (passedThrough) continue;
    const withdrawal = closestFirst(
      deposit.transaction_date,
      rows.filter(
        (row) =>
          !used.has(row.id) &&
          !shared(row) &&
          ownerOf(row) !== null &&
          row.amount < 0 &&
          // a Zelle into the joint account can look like paying the other person back
          (row.transaction_type === "transfer" || row.transaction_type === "reimbursement") &&
          toCents(row.amount) === -toCents(deposit.amount) &&
          Math.abs(daysBetween(deposit.transaction_date, row.transaction_date)) <= MATCH_WINDOW_DAYS,
      ),
    )[0];
    if (withdrawal) {
      used.add(withdrawal.id);
      result.push({ row: deposit, counterpartyId: ownerOf(withdrawal)! });
      continue;
    }
    // From an account that isn't imported (e.g. someone's savings): credit it to
    // whoever mentions that same account in their own transfers ("to SAV 1234").
    const reference = accountReference(deposit.original_description);
    if (reference) {
      const owner = rows.find(
        (row) => !shared(row) && ownerOf(row) !== null && accountReference(row.original_description) === reference,
      );
      if (owner) result.push({ row: deposit, counterpartyId: ownerOf(owner)! });
    }
  }
  return result;
}

/**
 * Money one of you sent the other through the joint account: into the joint
 * account from one person's account (or their savings), then straight back out
 * to the other person's own account. Returns the receiving row with the sender,
 * so it counts as the sender paying the receiver back.
 */
export function matchPassThroughPaybacks<T extends Row>(
  rows: T[],
  accounts: Map<string, Pick<AccountRow, "owner_user_id">>,
): { row: T; counterpartyId: string }[] {
  const ownerOf = (row: Row) => accounts.get(row.account_id)?.owner_user_id ?? null;
  const shared = (row: Row) => isSharedAccount(accounts.get(row.account_id));
  const sameCents = (a: Row, b: Row) => toCents(a.amount) === toCents(b.amount);
  const used = new Set<string>();
  const result: { row: T; counterpartyId: string }[] = [];

  for (const deposit of rows.filter(
    (row) => shared(row) && row.amount > 0 && row.transaction_type === "transfer" && row.counterparty_id === null,
  )) {
    const outflow = rows.find(
      (row) =>
        row.account_id === deposit.account_id &&
        row.amount < 0 &&
        toCents(row.amount) === -toCents(deposit.amount) &&
        daysBetween(deposit.transaction_date, row.transaction_date) >= 0 &&
        daysBetween(deposit.transaction_date, row.transaction_date) <= PASS_THROUGH_DAYS,
    );
    if (!outflow) continue;

    const reference = accountReference(deposit.original_description);
    const source =
      closestFirst(
        deposit.transaction_date,
        rows.filter(
          (row) =>
            !shared(row) &&
            ownerOf(row) !== null &&
            row.amount < 0 &&
            (row.transaction_type === "transfer" || row.transaction_type === "reimbursement") &&
            toCents(row.amount) === -toCents(deposit.amount) &&
            Math.abs(daysBetween(deposit.transaction_date, row.transaction_date)) <= MATCH_WINDOW_DAYS,
        ),
      )[0] ??
      (reference
        ? rows.find((row) => !shared(row) && ownerOf(row) !== null && accountReference(row.original_description) === reference)
        : undefined);
    const sender = source ? ownerOf(source) : null;
    if (!sender) continue;

    const receipt = closestFirst(
      outflow.transaction_date,
      rows.filter(
        (row) =>
          !used.has(row.id) &&
          !shared(row) &&
          ownerOf(row) !== null &&
          ownerOf(row) !== sender &&
          row.review_status !== "reviewed" &&
          ["transfer", "income", "reimbursement"].includes(row.transaction_type) &&
          sameCents(row, deposit) &&
          Math.abs(daysBetween(outflow.transaction_date, row.transaction_date)) <= MEMBER_MATCH_DAYS,
      ),
    )[0];
    if (!receipt) continue;
    used.add(receipt.id);
    if (receipt.transaction_type !== "reimbursement" || receipt.counterparty_id !== sender) {
      result.push({ row: receipt, counterpartyId: sender });
    }
  }
  return result;
}

/** "SAV 1234" / "CHK 1234" as named in Bank of America transfer descriptions. */
export function accountReference(description: string): string | null {
  const match = /\b(SAV|CHK)\s*(\d{4})\b/i.exec(description);
  return match ? `${match[1].toUpperCase()} ${match[2]}` : null;
}

/**
 * A withdrawal from someone's own account on its way into the joint account,
 * saved before the joint account's statement shows the deposit: a transfer
 * whose counterparty is the person paying in (the account's own owner). It
 * counts as paid into shared until the deposit is imported and paired with it.
 */
export function isPendingSharedFunding(
  row: Pick<TransactionRow, "transaction_type" | "amount" | "person_id" | "counterparty_id">,
): boolean {
  return (
    row.transaction_type === "transfer" && row.amount < 0 && row.person_id !== null && row.counterparty_id === row.person_id
  );
}

/** Where a withdrawal went: the account it names ("CHK 1234"), else the payee. */
function destination(row: Row): string {
  return accountReference(row.original_description) ?? row.normalized_merchant ?? row.original_description;
}

/**
 * Withdrawals that look like a deposit into the joint account the joint
 * account's statement doesn't reach yet: sent to the same place as earlier
 * withdrawals that were paired with joint deposits, and dated after (or just
 * before) the joint account's last imported transaction. Returns the rows to
 * mark as pending, and marked rows that turned out not to be (the statement now
 * covers their date and no deposit was credited to them).
 */
export function pendingSharedFunding<T extends Row>(
  rows: T[],
  accounts: Map<string, Pick<AccountRow, "owner_user_id">>,
): { pending: T[]; notPending: T[] } {
  const ownerOf = (row: Row) => accounts.get(row.account_id)?.owner_user_id ?? null;
  const sharedDates = rows.filter((row) => isSharedAccount(accounts.get(row.account_id))).map((row) => row.transaction_date);
  if (sharedDates.length === 0) return { pending: [], notPending: [] };
  const statementEnds = sharedDates.reduce((latest, date) => (date > latest ? date : latest));
  const awaiting = (row: Row) => row.transaction_date > addDays(statementEnds, -MATCH_WINDOW_DAYS);
  // The deposit is on the statement but wasn't credited (e.g. it passed straight through).
  const onStatement = (row: Row) =>
    rows.some(
      (deposit) =>
        isSharedAccount(accounts.get(deposit.account_id)) &&
        toCents(deposit.amount) === -toCents(row.amount) &&
        Math.abs(daysBetween(row.transaction_date, deposit.transaction_date)) <= MATCH_WINDOW_DAYS,
    );

  const paired = new Set(matchSharedAccountFunding(rows, accounts, { includeReviewed: true }).map((row) => row.id));
  const destinations = new Set(
    rows.filter((row) => paired.has(row.id) && !isPendingSharedFunding(row)).map((row) => `${row.account_id} ${destination(row)}`),
  );
  const pending = rows.filter(
    (row) =>
      row.amount < 0 &&
      row.review_status !== "reviewed" &&
      ownerOf(row) !== null &&
      (row.transaction_type === "transfer" || row.transaction_type === "reimbursement") &&
      !isPendingSharedFunding(row) &&
      !paired.has(row.id) &&
      awaiting(row) &&
      !onStatement(row) &&
      destinations.has(`${row.account_id} ${destination(row)}`),
  );
  const notPending = rows.filter(
    (row) => isPendingSharedFunding(row) && !paired.has(row.id) && (!awaiting(row) || onStatement(row)),
  );
  return { pending, notPending };
}
