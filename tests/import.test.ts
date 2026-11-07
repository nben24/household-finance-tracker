import { describe, expect, it } from "vitest";
import type { AccountRow, AccountType } from "@/lib/db/types";
import { classifyTransaction } from "@/lib/import/classify";
import { parseCsv } from "@/lib/import/csv";
import { normalizeMerchant } from "@/lib/import/merchant";
import { parseCsvFile } from "@/lib/import/parse-file";
import {
  buildTransactions,
  fingerprint,
  safeFileName,
  splitDuplicates,
  validateImportInput,
} from "@/lib/import/prepare";
import type { NormalizedTransaction, ParsedFile } from "@/lib/import/types";
import { hasExplicitSign, parseAmount, parseDate } from "@/lib/import/values";

// All CSV samples below are synthetic.

function parsed(text: string) {
  const result = parseCsvFile(text);
  if (result.status !== "ok") throw new Error(`Expected a readable file, got: ${result.message}`);
  return result as Extract<ParsedFile, { status: "ok" }>;
}

describe("CSV reader", () => {
  it("handles quotes, embedded commas, doubled quotes and line breaks", () => {
    const text = 'a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n1,2,3';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "line1\nline2"],
      ["1", "2", "3"],
    ]);
  });

  it("drops blank lines and a byte-order mark, keeps empty cells", () => {
    expect(parseCsv("﻿a,b\n\n,,\n1,\n")).toEqual([
      ["a", "b"],
      ["1", ""],
    ]);
  });
});

describe("reading amounts and dates", () => {
  it("reads the ways banks write money", () => {
    expect(parseAmount("-82.41")).toBe(-82.41);
    expect(parseAmount("$1,234.56")).toBe(1234.56);
    expect(parseAmount("($25.00)")).toBe(-25);
    expect(parseAmount("-$25.00")).toBe(-25);
    expect(parseAmount("+5")).toBe(5);
    expect(parseAmount("−12.30")).toBe(-12.3);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("N/A")).toBeNull();
    expect(parseAmount("12.3.4")).toBeNull();
  });

  it("knows whether an amount carries its own sign", () => {
    expect(hasExplicitSign("-5.00")).toBe(true);
    expect(hasExplicitSign("($5.00)")).toBe(true);
    expect(hasExplicitSign("$5.00")).toBe(false);
  });

  it("reads US and ISO dates and rejects impossible ones", () => {
    expect(parseDate("09/27/2026")).toBe("2026-09-27");
    expect(parseDate("9/7/26")).toBe("2026-09-07");
    expect(parseDate("2026-09-27")).toBe("2026-09-27");
    expect(parseDate("02/30/2026")).toBeNull();
    expect(parseDate("13/01/2026")).toBeNull();
    expect(parseDate("yesterday")).toBeNull();
  });
});

describe("Truist", () => {
  const header =
    "Posted Date,Transaction Date,Transaction Type,Check/Serial #,Full description,Merchant name,Category name,Sub-category name,Amount,Daily Posted Balance";

  it("reads parenthesized debits and plain credits", () => {
    const file = parsed(
      `${header}\n` +
        '09/28/2026,09/27/2026,Debit Card,,DEBIT CARD PURCHASE TRADER JOE S #123 ANYTOWN VA,Trader Joe\'s,Food,Groceries,($82.41),"$1,000.00"\n' +
        "09/25/2026,09/25/2026,Deposit,,NORTHSIDE HEALTH DIR DEP,,Income,Paycheck,\"$2,780.00\",\n",
    );
    expect(file.institution).toBe("Truist");
    expect(file.transactions).toEqual([
      {
        transactionDate: "2026-09-27",
        postingDate: "2026-09-28",
        originalDescription: "DEBIT CARD PURCHASE TRADER JOE S #123 ANYTOWN VA",
        amount: -82.41,
        transactionTypeHint: null,
        sourceId: null,
        merchantHint: "Trader Joe's",
        bankCategory: "Food / Groceries",
        balance: 1000,
      },
      expect.objectContaining({ transactionDate: "2026-09-25", amount: 2780, merchantHint: null }),
    ]);
  });

  it("uses the type column when the amount has no sign", () => {
    const file = parsed(
      `${header}\n` +
        "09/28/2026,09/27/2026,Debit,,SHELL OIL 123,Shell,Auto,Gas,$40.00,\n" +
        "09/28/2026,09/27/2026,Credit,,REFUND TARGET,Target,Shopping,,$15.00,\n",
    );
    expect(file.transactions.map((t) => t.amount)).toEqual([-40, 15]);
  });

  it("reports unreadable rows with their line number instead of failing", () => {
    const file = parsed(
      `${header}\n` +
        "09/28/2026,09/27/2026,Debit,,SHELL OIL 123,Shell,,,($40.00),\n" +
        "bad,bad,Debit,,SOMETHING,,,,($1.00),\n" +
        "09/28/2026,09/27/2026,Debit,,NO AMOUNT,,,,,\n",
    );
    expect(file.transactions).toHaveLength(1);
    expect(file.problems.map((problem) => problem.rowNumber)).toEqual([3, 4]);
  });
});

describe("American Express", () => {
  const header =
    "Date,Description,Amount,Extended Details,Appears On Your Statement As,Address,City/State,Zip Code,Country,Reference,Category";

  it("flips the sign: charges become negative, payments positive", () => {
    const file = parsed(
      `${header}\n` +
        '09/27/2026,CHIPOTLE 1234,14.85,"details",CHIPOTLE 1234 ANYTOWN VA,"1 MAIN ST","ANYTOWN\nVA",12345,UNITED STATES,\'320262700000000001\',Restaurant-Restaurant\n' +
        "09/25/2026,AUTOPAY PAYMENT - THANK YOU,-1500.00,,AUTOPAY PAYMENT - THANK YOU,,,,,'320262500000000002',\n",
    );
    expect(file.institution).toBe("American Express");
    expect(file.transactions[0]).toEqual({
      transactionDate: "2026-09-27",
      postingDate: null,
      originalDescription: "CHIPOTLE 1234 ANYTOWN VA",
      amount: -14.85,
      transactionTypeHint: null,
      sourceId: "320262700000000001",
      merchantHint: "CHIPOTLE 1234",
      bankCategory: "Restaurant-Restaurant",
      balance: null,
    });
    expect(file.transactions[1].amount).toBe(1500);
  });

  it("flags and discards the account column in multi-card exports", () => {
    const file = parsed(
      "Date,Description,Card Member,Account #,Amount\n09/27/2026,NETFLIX.COM,TEST PERSON,-00000,19.99\n",
    );
    expect(file.sensitiveHeaders).toEqual(["Account #"]);
    expect(JSON.stringify(file.transactions)).not.toContain("00000");
    expect(file.transactions[0].amount).toBe(-19.99);
  });
});

describe("Chase", () => {
  it("reads a checking export, including its trailing comma", () => {
    const file = parsed(
      "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\n" +
        "DEBIT,09/27/2026,SUMMIT HOME LOANS MTG PYMT,-2450.00,ACH_DEBIT,5000.00,,\n" +
        "CREDIT,09/26/2026,Zelle payment from TEST PERSON 123456,800.00,QUICKPAY_CREDIT,7450.00,,\n" +
        "DEBIT,09/25/2026,Online Transfer to SAV ...0000,-500.00,ACCT_XFER,6650.00,,\n",
    );
    expect(file.adapterId).toBe("chase-checking");
    expect(file.transactions.map((t) => [t.amount, t.transactionTypeHint])).toEqual([
      [-2450, null],
      [800, null],
      [-500, "transfer"],
    ]);
  });

  it("reads a credit card export and uses its type column", () => {
    const file = parsed(
      "Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n" +
        "09/26/2026,09/27/2026,AMZN Mktp US*AB1CD2EF3,Shopping,Sale,-47.21,\n" +
        "09/25/2026,09/25/2026,Payment Thank You-Mobile,,Payment,1850.00,\n" +
        "09/24/2026,09/25/2026,TARGET 00012345,Shopping,Return,25.00,\n",
    );
    expect(file.adapterId).toBe("chase-card");
    expect(file.transactions.map((t) => [t.transactionDate, t.postingDate, t.amount, t.transactionTypeHint])).toEqual([
      ["2026-09-26", "2026-09-27", -47.21, null],
      ["2026-09-25", "2026-09-25", 1850, "credit_card_payment"],
      ["2026-09-24", "2026-09-25", 25, "refund"],
    ]);
  });

  it("explains that investment exports aren't supported, and drops nothing into the app", () => {
    const result = parseCsvFile(
      "Trade Date,Post Date,Settlement Date,Account Name,Account Number,Account Type,Type,Description,Cusip,Ticker,Security Type,Local Currency,Price USD,Price Local,Quantity,G/L Short USD,G/L Short Local,G/L Long USDs,G/L Long Local,Amount USD,Amount Local,Income USD,Income Local,Balance,Commissions USD,Commissions Local,Tran Code,Tran Code Description,Broker,Check Number,Tax Withheld\n" +
        "09/27/2026,09/27/2026,09/28/2026,TEST,000000000,Brokerage,Buy,TEST FUND,000000000,TEST,ETF,USD,1,1,1,,,,,-1,-1,,,0,,,BUY,Buy,,,\n",
    );
    expect(result.status).toBe("unreadable");
    expect(result.status === "unreadable" && result.message).toMatch(/investment/i);
  });
});

describe("Bank of America", () => {
  it("skips the summary block and the beginning-balance line", () => {
    const file = parsed(
      "Description,,Summary Amt.\n" +
        'Beginning balance as of 09/01/2026,,"1,000.00"\n' +
        'Total credits,,"3,150.00"\n' +
        'Total debits,,"-285.00"\n' +
        'Ending balance as of 09/30/2026,,"3,865.00"\n' +
        "\n" +
        "Date,Description,Amount,Running Bal.\n" +
        '09/01/2026,Beginning balance as of 09/01/2026,,"1,000.00"\n' +
        '09/03/2026,"OAKWOOD COMMONS HOA DES:DUES ID:XXXXX INDN:TEST PERSON","-285.00","715.00"\n' +
        '09/04/2026,"ACME CORP DES:PAYROLL ID:XXXXX","3,150.00","3,865.00"\n',
    );
    expect(file.adapterId).toBe("bofa-checking");
    expect(file.problems).toEqual([]);
    expect(file.transactions.map((t) => [t.transactionDate, t.amount])).toEqual([
      ["2026-09-03", -285],
      ["2026-09-04", 3150],
    ]);
  });

  it("reads a credit card export", () => {
    const file = parsed(
      "Posted Date,Reference Number,Payee,Address,Amount\n" +
        '09/27/2026,24000000000000000000001,"STARBUCKS STORE 08842","ANYTOWN VA",-5.75\n',
    );
    expect(file.adapterId).toBe("bofa-card");
    expect(file.transactions[0]).toMatchObject({ amount: -5.75, sourceId: "24000000000000000000001" });
  });
});

describe("unrecognized files", () => {
  it("says so plainly", () => {
    expect(parseCsvFile("Name,Favorite Color\nA,Blue\n").status).toBe("unreadable");
    expect(parseCsvFile("").status).toBe("unreadable");
  });
});

describe("merchant names", () => {
  it("collapses known merchants' many spellings", () => {
    for (const text of ["AMZN MKTP US*123ABC", "AMAZON.COM*123ABC", "Amazon Marketplace"]) {
      expect(normalizeMerchant(text), text).toBe("Amazon");
    }
    for (const text of ["SQ *CHIPOTLE", "CHIPOTLE 1234", "CHIPOTLE MEXICAN GRILL"]) {
      expect(normalizeMerchant(text), text).toBe("Chipotle");
    }
    expect(normalizeMerchant("AMAZON PRIME*2R4TY81X3")).toBe("Amazon Prime");
    expect(normalizeMerchant("TRADER JOE S #123")).toBe("Trader Joe's");
    expect(normalizeMerchant("UBER *EATS PENDING")).toBe("Uber Eats");
    expect(normalizeMerchant("UBER *TRIP")).toBe("Uber");
    expect(normalizeMerchant("OPENAI *CHATGPT SUBSCR")).toBe("ChatGPT");
  });

  it("tidies unknown merchants: prefixes, store numbers and reference codes", () => {
    expect(normalizeMerchant("SQ *LUNA NAIL STUDIO")).toBe("Luna Nail Studio");
    expect(normalizeMerchant("TST* THE LOCAL TAVERN 6987")).toBe("The Local Tavern");
    expect(normalizeMerchant("DEBIT CARD PURCHASE JIFFY LUBE #2291")).toBe("Jiffy Lube");
    expect(normalizeMerchant("RIVERSIDE ANIMAL HOSPITAL 09/27 555-123-4567")).toBe("Riverside Animal Hospital");
  });

  it("prefers the bank's own merchant name when there is one", () => {
    expect(normalizeMerchant("POS 4432 XJ29 PURCHASE 0927", "Corner Bakery")).toBe("Corner Bakery");
    expect(normalizeMerchant("POS 4432", "WHOLEFDS MKT")).toBe("Whole Foods");
  });

  it("never returns an empty name", () => {
    expect(normalizeMerchant("123456")).toBe("123456");
  });
});

describe("transaction type", () => {
  const JOHN = "john-id";
  const JANE = "jane-id";
  const members = [
    { id: JOHN, name: "John" },
    { id: JANE, name: "Jane" },
  ];
  const classifyFull = (description: string, amount: number, accountType: AccountType, ownerId: string | null = JOHN) =>
    classifyTransaction({ originalDescription: description, amount, transactionTypeHint: null }, accountType, {
      ownerId,
      members,
    });
  const classify = (description: string, amount: number, accountType: AccountType, ownerId: string | null = JOHN) =>
    classifyFull(description, amount, accountType, ownerId).type;

  it("treats card payments as payments on both sides, never as spending", () => {
    expect(classify("AMEX EPAYMENT ACH PMT", -1500, "checking")).toBe("credit_card_payment");
    expect(classify("CHASE CREDIT CRD AUTOPAY", -1850, "checking")).toBe("credit_card_payment");
    expect(classify("AUTOPAY PAYMENT - THANK YOU", 1500, "credit_card")).toBe("credit_card_payment");
    expect(classify("Online Banking payment to CRD 0000 Confirmation# x1y2z3", -800, "checking")).toBe("credit_card_payment");
  });

  it("treats moves between own accounts as transfers", () => {
    expect(classify("ONLINE TRANSFER TO SAV ...0000", -500, "checking")).toBe("transfer");
    expect(classify("ONLINE TRANSFER FROM CHK", 500, "savings")).toBe("transfer");
  });

  it("treats a transfer to an American Express savings account as a transfer, though Truist calls it a card payment", () => {
    const toSavings = (amount: number) =>
      classifyTransaction(
        {
          originalDescription: "TRANSFER AMERICANEXPRESS ***********1234 JOHN INTERNET PAYMENT",
          amount,
          transactionTypeHint: null,
          bankCategory: "Transfers & Payments / Credit card payments",
        },
        "checking",
        { ownerId: JOHN, members },
      ).type;
    expect(toSavings(-600)).toBe("transfer");
    expect(toSavings(200)).toBe("transfer");
    expect(classify("AMEX EPAYMENT ACH PMT M1234 INTERNET PAYMENT", -875.4, "checking")).toBe("credit_card_payment");
  });

  it("treats Zelle into or out of the joint account as a transfer", () => {
    expect(classify("Zelle payment from JOHN TEST", 800, "checking", null)).toBe("transfer");
    expect(classify("Zelle payment from JANE TEST", 800, "checking", null)).toBe("transfer");
  });

  it("treats Zelle to your own name as a transfer", () => {
    expect(classify("Zelle payment to JOHN TEST", -800, "checking", JOHN)).toBe("transfer");
  });

  it("treats Zelle with the other person as a payback, naming them, and asks to confirm", () => {
    expect(classifyFull("Zelle payment from JANE TEST", 200, "checking", JOHN)).toMatchObject({
      type: "reimbursement",
      confidence: "medium",
      counterpartyId: JANE,
    });
    expect(classifyFull("Zelle payment to JOHN TEST", -200, "checking", JANE)).toMatchObject({
      type: "reimbursement",
      counterpartyId: JOHN,
    });
  });

  it("matches whole first names only", () => {
    expect(classify("Zelle payment to JOHNSON SMITH", -40, "checking", JANE)).toBe("expense");
  });

  it("does not assume a Zelle to someone else is between you", () => {
    expect(classifyFull("Zelle payment to SAM R", -40, "checking")).toMatchObject({ type: "expense", confidence: "low" });
  });

  it("recognizes income, refunds, investments and ordinary spending", () => {
    expect(classify("ACME CORP PAYROLL PPD", 3150, "checking")).toBe("income");
    expect(classify("INTEREST PAYMENT", 4.12, "savings")).toBe("income");
    expect(classify("AMZN MKTP US REFUND", 25, "credit_card")).toBe("refund");
    expect(classify("VANGUARD BUY INVESTMENT", -400, "checking")).toBe("investment_contribution");
    expect(classify("COINBASE.COM", -100, "checking")).toBe("investment_contribution");
    expect(classify("TRADER JOE S #123", -82.41, "credit_card")).toBe("expense");
    expect(classify("SUMMIT HOME LOANS MTG PYMT", -2450, "checking")).toBe("expense");
  });

  it("is unsure about unexplained money in", () => {
    expect(classifyFull("MOBILE DEPOSIT", 120, "checking")).toMatchObject({ type: "income", confidence: "low" });
  });
});

describe("preparing rows to save", () => {
  const account = (id: string, type: AccountType, owner: string | null): AccountRow => ({
    id,
    household_id: "11111111-1111-4111-8111-111111111111",
    owner_user_id: owner,
    institution: "Test Bank",
    account_name: "Test",
    account_type: type,
    last_four: null,
    is_active: true,
    created_at: "2026-10-01T00:00:00Z",
  });
  const CARD = "22222222-2222-4222-8222-222222222222";
  const CHECKING = "33333333-3333-4333-8333-333333333333";
  const OWNER = "44444444-4444-4444-8444-444444444444";
  const accounts = [account(CARD, "credit_card", OWNER), account(CHECKING, "checking", null)];

  const coffee: NormalizedTransaction = {
    transactionDate: "2026-09-27",
    postingDate: null,
    originalDescription: "STARBUCKS STORE 08842",
    amount: -5.75,
    transactionTypeHint: null,
    sourceId: null,
    merchantHint: null,
    bankCategory: null,
  };
  const file = (transactions: NormalizedTransaction[], accountId = CARD) => ({
    fileName: "activity.csv",
    accountId,
    transactions,
  });

  it("keeps two identical same-day purchases as two transactions", () => {
    const rows = buildTransactions([file([coffee, coffee])], accounts, []);
    expect(rows).toHaveLength(2);
    expect(rows[0].source_hash).not.toBe(rows[1].source_hash);
    expect(splitDuplicates(rows, []).fresh).toHaveLength(2);
  });

  it("recognizes everything in a file that was already imported", () => {
    const first = buildTransactions([file([coffee, coffee])], accounts, []);
    const again = buildTransactions([file([coffee, coffee])], accounts, []);
    const result = splitDuplicates(again, first.map((row) => row.source_hash));
    expect(result.fresh).toHaveLength(0);
    expect(result.duplicates).toHaveLength(2);
  });

  it("imports only the new rows from an overlapping export", () => {
    const first = buildTransactions([file([coffee])], accounts, []);
    const later = { ...coffee, transactionDate: "2026-09-28" };
    const overlap = buildTransactions([file([later, coffee])], accounts, []);
    const result = splitDuplicates(overlap, first.map((row) => row.source_hash));
    expect(result.fresh.map((row) => row.transaction_date)).toEqual(["2026-09-28"]);
  });

  it("catches the same file chosen twice in one import", () => {
    const rows = buildTransactions([file([coffee]), file([coffee])], accounts, []);
    const result = splitDuplicates(rows, []);
    expect(result.fresh).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
  });

  it("does not confuse the same purchase on two different accounts", () => {
    expect(fingerprint(CARD, coffee, 0)).not.toBe(fingerprint(CHECKING, coffee, 0));
  });

  it("ignores spacing and capitalization differences in the description", () => {
    const messy = { ...coffee, originalDescription: "Starbucks   Store 08842" };
    expect(fingerprint(CARD, messy, 0)).toBe(fingerprint(CARD, coffee, 0));
  });

  it("uses the bank's reference when present, so description changes don't matter", () => {
    const pending = { ...coffee, sourceId: "REF1", originalDescription: "STARBUCKS PENDING" };
    const posted = { ...coffee, sourceId: "REF1" };
    expect(fingerprint(CARD, pending, 0)).toBe(fingerprint(CARD, posted, 0));
  });

  it("fills in owner, merchant, type and review status", () => {
    const payment = { ...coffee, originalDescription: "PAYMENT THANK YOU", amount: 500 };
    const [purchase, cardPayment] = buildTransactions([file([coffee, payment])], accounts, []);
    expect(purchase).toMatchObject({
      account_id: CARD,
      person_id: OWNER,
      normalized_merchant: "Starbucks",
      transaction_type: "expense",
      category_id: null,
      review_status: "needs_review",
      source_file: "activity.csv",
    });
    expect(cardPayment).toMatchObject({ transaction_type: "credit_card_payment", review_status: "auto_categorized" });
    const [joint] = buildTransactions([file([coffee], CHECKING)], accounts, []);
    expect(joint.person_id).toBeNull();
  });
});

describe("validating what the browser sends", () => {
  const good = {
    fileName: "Chase1234567_Activity.csv",
    accountId: "22222222-2222-4222-8222-222222222222",
    transactions: [
      {
        transactionDate: "2026-09-27",
        postingDate: null,
        originalDescription: "  STARBUCKS  ",
        amount: -5.754,
        transactionTypeHint: null,
        sourceId: null,
        merchantHint: null,
        accountNumber: "should be dropped",
      },
    ],
  };
  const withRow = (changes: object) => [{ ...good, transactions: [{ ...good.transactions[0], ...changes }] }];

  it("accepts good input, rounding to cents and dropping unexpected fields", () => {
    const [file] = validateImportInput([good])!;
    expect(file.transactions[0]).toEqual({
      transactionDate: "2026-09-27",
      postingDate: null,
      originalDescription: "STARBUCKS",
      amount: -5.75,
      transactionTypeHint: null,
      sourceId: null,
      merchantHint: null,
      bankCategory: null,
    });
    expect(file.fileName).toBe("Chase…_Activity.csv");
  });

  it("rejects malformed input", () => {
    expect(validateImportInput(null)).toBeNull();
    expect(validateImportInput([])).toBeNull();
    expect(validateImportInput([{ ...good, accountId: "not-an-id" }])).toBeNull();
    expect(validateImportInput(withRow({ transactionDate: "09/27/2026" }))).toBeNull();
    expect(validateImportInput(withRow({ amount: "5" }))).toBeNull();
    expect(validateImportInput(withRow({ amount: Number.NaN }))).toBeNull();
    expect(validateImportInput(withRow({ originalDescription: "   " }))).toBeNull();
    expect(validateImportInput(withRow({ transactionTypeHint: "free_money" }))).toBeNull();
    expect(validateImportInput(Array.from({ length: 11 }, () => good))).toBeNull();
  });

  it("strips long digit runs and odd characters from file names", () => {
    expect(safeFileName("stmt_000123456789.csv")).toBe("stmt_….csv");
    expect(safeFileName("<script>.csv")).toBe("script.csv");
    expect(safeFileName(42)).toBe("upload.csv");
  });
});

describe("investments the bank labels for you", () => {
  const people = { ownerId: "n", members: [{ id: "n", name: "John" }] };
  const classify = (description: string, amount: number, bankCategory: string | null = null) =>
    classifyTransaction({ originalDescription: description, amount, transactionTypeHint: null, bankCategory }, "checking", people);

  it("treats Truist's 'Savings & Investments' label as investing, whatever the company", () => {
    expect(classify("SOME NEW BROKER LLC TRANSFER", -500, "Savings & Investments / Investments")).toMatchObject({
      type: "investment_contribution",
      confidence: "high",
    });
    expect(classify("SOME NEW BROKER LLC", 200, "Savings & Investments / Investments").type).toBe("investment_withdrawal");
  });

  it("recognizes JPMorgan and other brokerages by name", () => {
    for (const name of ["JPMORGAN CHASE INVEST", "J.P. MORGAN SECURITIES", "MERRILL EDGE", "ACORNS INVEST"]) {
      expect(classify(name, -100).type, name).toBe("investment_contribution");
    }
  });

  it("uses Truist's transfer and card-payment labels", () => {
    expect(classify("ONLINE TRANSFER 1234", -100, "Transfers & Payments / Transfers between own accounts").type).toBe("transfer");
    expect(classify("SOME BANK PAYMENT", -100, "Transfers & Payments / Credit card payments").type).toBe("credit_card_payment");
  });

  it("doesn't let an ordinary purchase be mistaken for one", () => {
    expect(classify("TRADER JOE S", -50, "Food / Groceries").type).toBe("expense");
  });
});
