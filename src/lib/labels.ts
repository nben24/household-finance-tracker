import type { AccountType, BudgetKind, ExpenseType, TransactionType } from "@/lib/db/types";

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
  credit_card_payment: "Card payment",
  refund: "Refund",
  adjustment: "Adjustment",
  investment_contribution: "Investment",
  investment_withdrawal: "Investment withdrawal",
  reimbursement: "Paying each other back",
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: "Checking",
  savings: "Savings",
  credit_card: "Credit card",
  brokerage: "Brokerage",
  retirement: "Retirement",
  hsa: "HSA",
  crypto: "Crypto",
  mortgage: "Mortgage",
  other: "Other",
  property: "Home or property",
  vehicle: "Vehicle",
  loan: "Loan",
};

export const EXPENSE_TYPE_LABELS: Record<ExpenseType, string> = {
  fixed: "Fixed",
  variable: "Variable",
  discretionary: "Discretionary",
  irregular: "Irregular",
};

export const BUDGET_KIND_LABELS: Record<BudgetKind, string> = {
  fixed: "Fixed bill",
  variable: "Everyday spending",
  allowance: "Personal allowance",
  sinking_fund: "Saving up (irregular)",
};

export const BUDGET_KIND_HINTS: Record<BudgetKind, string> = {
  fixed: "About the same every month, like the mortgage or internet.",
  variable: "Needed, but changes month to month, like groceries or gas.",
  allowance: "Each person's own money to spend freely, like play money.",
  sinking_fund: "Set aside a little each month for things that come up occasionally, like travel or car repairs. Unspent money carries over.",
};
