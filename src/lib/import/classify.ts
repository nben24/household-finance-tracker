// Decides what kind of transaction a row is. The sign alone is never enough:
// transfers and card payments must not be counted as spending or income.

import type { AccountType, ConfidenceLevel, TransactionType } from "@/lib/db/types";
import type { NormalizedTransaction } from "./types";

export interface Classification {
  type: TransactionType;
  confidence: ConfidenceLevel;
  reason: string;
  /**
   * The other household member involved: for a payback, the other person; for
   * money paid into the joint account, who paid it in.
   */
  counterpartyId?: string;
}

export interface AccountPeople {
  /** owner of the account the row came from; null for a joint account */
  ownerId: string | null;
  members: { id: string; name: string }[];
}

const CARD_PAYMENT_FROM_BANK =
  /CREDIT C(A)?RD|CRD (AUTOPAY|EPAY)|CARD ?MEMBER|CARDMEMBER|AMEX|AMERICAN EXPRESS|CAPITAL ONE.*(PMT|PAYMENT|CRCARDPMT)|DISCOVER.*(PMT|PAYMENT)|CITI ?CARD|BARCLAYCARD|CARD (PMT|PAYMENT)|(PAYMENT|PMT) TO CRD\b/;
/**
 * Money moved to (or back from) an online savings account at another bank. The
 * sending bank may label it a card payment (a transfer to an American Express
 * savings account can show up as "Credit card payments"), so this is checked
 * first. Amex card payments read differently ("AMEX EPAYMENT ACH PMT").
 */
export const SAVINGS_ACCOUNT_TRANSFER = /\bTRANSFER AMERICANEXPRESS\b|\bAMERICANEXPRESS TRANSFER\b/;
const TRANSFER = /\b(TRANSFER|XFER|TRNSFR)\b|\b(TO|FROM) (SAV|SAVINGS|CHK|CHECKING)\b/;
const INVESTMENT =
  /VANGUARD|FIDELITY|SCHWAB|ROBINHOOD|COINBASE|BROKERAGE|E\*?TRADE|BETTERMENT|WEALTHFRONT|JPMORGAN|J\.?P\.? ?MORGAN|MERRILL|EDWARD ?JONES|TD AMERITRADE|ACORNS|STASH|M1 FINANCE|TREASURYDIRECT|KRAKEN|GEMINI|INTERACTIVE BROKERS|SOFI INVEST|PUBLIC\.COM|WEBULL/;
const PAYROLL = /PAYROLL|DIRECT DEP|DIR DEP|DIRECTDEP|SALARY|PAYCHECK|\bPPD\b/;
const INTEREST = /INTEREST (PAYMENT|PAID|EARNED|CREDIT)|\bINT (PAYMENT|EARNED)\b/;
const CARD_PAYMENT_ON_CARD = /PAYMENT|AUTOPAY|THANK YOU|\bPYMT\b|\bPMT\b/;

const BANK_ACCOUNTS: AccountType[] = ["checking", "savings"];

function membersMentioned(text: string, members: AccountPeople["members"]) {
  return members.filter((member) => {
    const firstName = member.name.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
    return firstName.length >= 3 && new RegExp(`\\b${firstName}\\b`).test(text);
  });
}

/**
 * Zelle between household members:
 * - into or out of a joint account → moving money between our accounts
 * - between one person's account and the other person → paying each other back
 * - to your own name → moving money between our accounts
 * Anyone else is ordinary income or spending, flagged for review.
 */
function classifyZelle(text: string, moneyIn: boolean, people: AccountPeople): Classification {
  const mentioned = membersMentioned(text, people.members);
  const other = mentioned.find((member) => member.id !== people.ownerId);
  if (people.ownerId !== null && other) {
    return {
      type: "reimbursement",
      confidence: "medium",
      reason: `Zelle with ${other.name} — paying each other back?`,
      counterpartyId: other.id,
    };
  }
  if (mentioned.length > 0) {
    // Into the joint account: remember who paid in, for the shared account view.
    const contributor = people.ownerId === null && moneyIn && mentioned.length === 1 ? mentioned[0] : null;
    return {
      type: "transfer",
      confidence: "medium",
      reason: contributor ? `Paid into the shared account by ${contributor.name}` : "Zelle between our own accounts",
      ...(contributor ? { counterpartyId: contributor.id } : {}),
    };
  }
  return {
    type: moneyIn ? "income" : "expense",
    confidence: "low",
    reason: "Zelle with someone outside the household",
  };
}

/** The bank's own label, when it says plainly what kind of money movement this is. */
function fromBankLabel(label: string, moneyIn: boolean): Classification | null {
  const text = label.toLowerCase();
  if (text.startsWith("savings & investments")) {
    return {
      type: moneyIn ? "investment_withdrawal" : "investment_contribution",
      confidence: "high",
      reason: "The bank labeled it savings or investments",
    };
  }
  if (text.includes("transfers between own accounts")) {
    return { type: "transfer", confidence: "high", reason: "The bank labeled it a transfer between your accounts" };
  }
  if (text.includes("credit card payments") && !moneyIn) {
    return { type: "credit_card_payment", confidence: "high", reason: "The bank labeled it a card payment" };
  }
  return null;
}

export function classifyTransaction(
  transaction: Pick<NormalizedTransaction, "originalDescription" | "amount" | "transactionTypeHint"> & {
    bankCategory?: string | null;
  },
  accountType: AccountType,
  people: AccountPeople,
): Classification {
  const text = transaction.originalDescription.toUpperCase();
  const moneyIn = transaction.amount > 0;

  if (transaction.transactionTypeHint) {
    return { type: transaction.transactionTypeHint, confidence: "high", reason: "The bank labeled it" };
  }

  if (accountType === "credit_card") {
    if (!moneyIn) return { type: "expense", confidence: "high", reason: "Card purchase" };
    if (CARD_PAYMENT_ON_CARD.test(text)) {
      return { type: "credit_card_payment", confidence: "high", reason: "Payment toward the card" };
    }
    return { type: "refund", confidence: "medium", reason: "Money back on a card" };
  }

  if (BANK_ACCOUNTS.includes(accountType)) {
    if (SAVINGS_ACCOUNT_TRANSFER.test(text)) {
      return { type: "transfer", confidence: "high", reason: "Moving money to or from your savings account" };
    }
    const labeled = transaction.bankCategory ? fromBankLabel(transaction.bankCategory, moneyIn) : null;
    if (labeled) return labeled;
    if (!moneyIn && CARD_PAYMENT_FROM_BANK.test(text)) {
      return { type: "credit_card_payment", confidence: "high", reason: "Payment to a credit card" };
    }
    if (text.includes("ZELLE")) return classifyZelle(text, moneyIn, people);
    if (INVESTMENT.test(text)) {
      return {
        type: moneyIn ? "investment_withdrawal" : "investment_contribution",
        confidence: "medium",
        reason: "Investment company",
      };
    }
    if (TRANSFER.test(text)) {
      return { type: "transfer", confidence: "medium", reason: "Transfer between accounts" };
    }
    if (moneyIn && INTEREST.test(text)) return { type: "income", confidence: "high", reason: "Interest" };
    if (moneyIn && PAYROLL.test(text)) return { type: "income", confidence: "high", reason: "Paycheck" };
    if (moneyIn) return { type: "income", confidence: "low", reason: "Money in from an unfamiliar source" };
    return { type: "expense", confidence: "high", reason: "Payment from a bank account" };
  }

  return {
    type: moneyIn ? "income" : "expense",
    confidence: "low",
    reason: "Unfamiliar account type",
  };
}
