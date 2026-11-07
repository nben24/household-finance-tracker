import type { NewTransaction } from "@/lib/import/prepare";
import type { TransactionInsert } from "@/lib/db/types";
import type {
  IncomeSourceRow,
  AccountBalanceRow,
  AccountRow,
  AccountType,
  BudgetLineRow,
  RecurringOverrideRow,
  RecurringStatus,
  CategorizationRuleRow,
  ExpenseType,
  RuleMatchType,
  RuleSource,
  TransactionType,
  CategoryRow,
  HouseholdRole,
  HouseholdRow,
  ProfileRow,
  TransactionRow,
} from "@/lib/db/types";

export interface Member extends ProfileRow {
  role: HouseholdRole;
}

export interface SessionContext {
  user: { id: string; email: string; name: string };
  /** null when the signed-in person has not been added to a household yet */
  household: HouseholdRow | null;
  members: Member[];
  isDemo: boolean;
}

export interface TransactionFilter {
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  /** a member's id, or "household" for shared (no person) */
  personId?: string;
  needsReview?: boolean;
  /** only hand-added entries still waiting to show up in a bank download */
  awaitingPost?: boolean;
  search?: string;
}

/**
 * Order for a page of transactions. Amounts are signed (money out is
 * negative), so "biggest money out" is the most negative first.
 */
export const TRANSACTION_SORTS = ["newest", "oldest", "largest_out", "largest_in"] as const;
export type TransactionSort = (typeof TRANSACTION_SORTS)[number];

export interface Page {
  limit: number;
  offset: number;
  /** default: newest */
  sort?: TransactionSort;
}

export interface NewAccount {
  institution: string;
  account_name: string;
  account_type: AccountType;
  owner_user_id: string | null;
  last_four: string | null;
}

export interface RuleInput {
  match_type: RuleMatchType;
  pattern: string;
  category_id: string;
  subcategory_id: string;
  auto_apply: boolean;
  source: RuleSource;
}

/** Fields a person can change on a transaction. */
export interface TransactionChanges {
  transaction_type?: TransactionType;
  counterparty_id?: string | null;
  normalized_merchant?: string;
  category_id?: string | null;
  subcategory_id?: string | null;
  expense_type?: ExpenseType | null;
  review_status?: TransactionRow["review_status"];
  categorization_confidence?: TransactionRow["categorization_confidence"];
  categorization_reason?: string | null;
  notes?: string | null;
  awaiting_post?: boolean;
  is_private?: boolean;
  private_until?: string | null;
}

export interface CategoryInput {
  parent_id: string | null;
  name: string;
  default_expense_type: ExpenseType | null;
  sort_order: number;
}

export type NewBudgetLine = Omit<BudgetLineRow, "id" | "household_id" | "created_at">;

export interface DataSource {
  getSession(): Promise<SessionContext | null>;
  listAccounts(householdId: string): Promise<AccountRow[]>;
  listCategories(householdId: string): Promise<CategoryRow[]>;
  /** Newest first unless the page says otherwise. Without a page, returns every matching row. */
  listTransactions(
    householdId: string,
    filter?: TransactionFilter,
    page?: Page,
  ): Promise<{ rows: TransactionRow[]; total: number }>;

  createAccount(householdId: string, account: NewAccount): Promise<AccountRow>;
  /** Fingerprints already saved for an account within a date range. */
  listSourceHashes(householdId: string, accountId: string, from: string, to: string): Promise<string[]>;
  /** Saves rows, silently skipping any whose fingerprint already exists. Returns how many were added. */
  insertTransactions(rows: Omit<TransactionInsert, "id" | "created_at" | "updated_at">[]): Promise<number>;
  /** Fills in the bank's category on already-saved rows that don't have one. */
  fillBankCategories(householdId: string, rows: Pick<NewTransaction, "account_id" | "source_hash" | "bank_category">[]): Promise<void>;

  getTransaction(householdId: string, id: string): Promise<TransactionRow | null>;
  updateTransactions(householdId: string, ids: string[], changes: TransactionChanges): Promise<number>;

  listRules(householdId: string): Promise<CategorizationRuleRow[]>;
  /** Insert, or replace the rule with the same match type and pattern. */
  saveRule(householdId: string, rule: RuleInput): Promise<void>;
  /** Insert rules that don't exist yet; existing ones are left untouched. */
  addMissingRules(householdId: string, rules: RuleInput[]): Promise<void>;
  updateRule(householdId: string, id: string, changes: Partial<RuleInput>): Promise<void>;
  deleteRule(householdId: string, id: string): Promise<void>;

  createCategory(householdId: string, category: CategoryInput): Promise<CategoryRow>;
  updateCategory(householdId: string, id: string, changes: { name?: string; is_active?: boolean }): Promise<void>;

  listBudgetLines(householdId: string): Promise<BudgetLineRow[]>;
  createBudgetLine(householdId: string, line: NewBudgetLine): Promise<void>;
  updateBudgetLine(
    householdId: string,
    id: string,
    changes: Partial<Pick<BudgetLineRow, "amount" | "kind" | "ends_month">>,
  ): Promise<void>;
  deleteBudgetLine(householdId: string, id: string): Promise<void>;

  updateHouseholdSettings(householdId: string, changes: { review_starts_on: string | null }): Promise<void>;

  /** Removes one transaction (used only for hand-added entries). */
  deleteTransaction(householdId: string, id: string): Promise<void>;
  /** Turns a hand-added entry into the bank's version of it. */
  replaceManualEntry(householdId: string, id: string, row: Partial<TransactionRow>): Promise<void>;

  listRecurringOverrides(householdId: string): Promise<RecurringOverrideRow[]>;
  /** Pass null to forget an override. */
  setRecurringOverride(householdId: string, key: string, status: RecurringStatus | null): Promise<void>;

  listBalances(householdId: string): Promise<AccountBalanceRow[]>;
  /** A balance typed in: replaces any balance for that account on that date. */
  saveBalance(householdId: string, balance: { account_id: string; as_of: string; balance: number }): Promise<void>;
  /** A balance read from an import: never replaces one already recorded for that date. */
  recordImportedBalance(householdId: string, balance: { account_id: string; as_of: string; balance: number }): Promise<void>;
  deleteBalance(householdId: string, id: string): Promise<void>;
  updateAccount(
    householdId: string,
    id: string,
    changes: Partial<Pick<AccountRow, "account_name" | "institution" | "is_active">>,
  ): Promise<void>;

  listIncomeSources(householdId: string): Promise<IncomeSourceRow[]>;
  saveIncomeSource(
    householdId: string,
    source: Omit<IncomeSourceRow, "id" | "household_id" | "created_at" | "is_active">,
    id?: string,
  ): Promise<void>;
  deleteIncomeSource(householdId: string, id: string): Promise<void>;
}
