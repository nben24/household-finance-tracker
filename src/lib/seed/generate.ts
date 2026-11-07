// Deterministic synthetic household data. Nothing here is real: merchants,
// amounts and employers are invented. The same generator feeds demo mode,
// `npm run db:seed`, and the tests.

import { DEFAULT_CATEGORIES } from "@/lib/categories/defaults";
import { defaultRuleRows } from "@/lib/categories/setup";
import { WEEK_STARTS_ON } from "@/lib/config";
import { addDays, addMonths, daysBetween, monthKey, monthRange, weekRange } from "@/lib/dates";
import {
  isTransferType,
  type AccountRow,
  type AccountBalanceRow,
  type AccountType,
  type BudgetLineRow,
  type CategorizationRuleRow,
  type CategoryRow,
  type ExpenseType,
  type HouseholdMemberRow,
  type HouseholdRow,
  type IncomeSourceRow,
  type TransactionRow,
  type TransactionType,
} from "@/lib/db/types";
import { countsAsSpending } from "@/lib/finance/summary";
import { toCents } from "@/lib/money";

export interface SeedOptions {
  /** Last day to generate (usually today), 'YYYY-MM-DD'. */
  endDate: string;
  johnId: string;
  janeId: string;
  /** Calendar months to cover, counting the month of endDate. */
  months?: number;
  seed?: number;
  householdName?: string;
}

export interface SeedData {
  household: HouseholdRow;
  members: HouseholdMemberRow[];
  accounts: AccountRow[];
  categories: CategoryRow[];
  rules: CategorizationRuleRow[];
  budgets: BudgetLineRow[];
  balances: AccountBalanceRow[];
  incomeSources: IncomeSourceRow[];
  transactions: TransactionRow[];
}

interface Entry {
  date: string;
  account: AccountRow;
  person: string | null;
  description: string;
  merchant: string;
  amount: number;
  type?: TransactionType;
  /** "Category/Subcategory" */
  category?: string;
  recurring?: boolean;
  /** Merchant the rules would not recognize. */
  unknown?: boolean;
  /** Recognized merchant whose category varies (e.g. Amazon). */
  uncertain?: boolean;
  /** for paybacks between the two people */
  counterparty?: string;
  /** shown instead of the default "why it was sorted this way" */
  reason?: string;
  /** a purchase kept private from the other person until this date */
  privateUntil?: string;
  /** added by hand, still waiting to show up in a bank download */
  awaitingPost?: boolean;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PAYDAY_ANCHOR = "2026-01-02"; // a Friday

export function generateSeedData(options: SeedOptions): SeedData {
  const { endDate, johnId, janeId, months = 7, seed = 20261001 } = options;
  const random = mulberry32(seed);
  const createdAt = `${endDate}T12:00:00.000Z`;

  const uuid = (): string => {
    let hex = "";
    for (let i = 0; i < 32; i++) hex += Math.floor(random() * 16).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
  };
  const chance = (probability: number) => random() < probability;
  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
  const between = (min: number, max: number) => Math.round((min + random() * (max - min)) * 100) / 100;

  const household: HouseholdRow = {
    id: uuid(),
    name: options.householdName ?? "John & Jane Doe",
    review_starts_on: null,
    created_at: createdAt,
  };

  const members: HouseholdMemberRow[] = [
    { household_id: household.id, user_id: johnId, role: "owner", created_at: createdAt },
    { household_id: household.id, user_id: janeId, role: "member", created_at: createdAt },
  ];

  const account = (
    institution: string,
    name: string,
    type: AccountType,
    owner: string | null,
    lastFour: string,
  ): AccountRow => ({
    id: uuid(),
    household_id: household.id,
    owner_user_id: owner,
    institution,
    account_name: name,
    account_type: type,
    last_four: lastFour,
    is_active: true,
    created_at: createdAt,
  });

  const jointChecking = account("Chase", "Joint Checking", "checking", null, "0001");
  const janeChecking = account("Wells Fargo", "Jane's Checking", "checking", janeId, "0002");
  const johnChecking = account("Capital One", "John's Checking", "checking", johnId, "0007");
  const johnCard = account("Chase", "Sapphire Card", "credit_card", johnId, "0003");
  const janeCard = account("Discover", "Discover it Card", "credit_card", janeId, "0004");
  const savings = account("Ally", "Household Savings", "savings", null, "0005");
  const johnSavings = account("Capital One", "John's Savings", "savings", johnId, "0011");
  const janeSavings = account("Wells Fargo", "Jane's Savings", "savings", janeId, "0012");
  const brokerage = account("Vanguard", "Brokerage", "brokerage", johnId, "0006");
  const retirement = account("Fidelity", "401(k)", "retirement", janeId, "0008");
  const home = account("House", "House", "property", null, "0009");
  const mortgage = account("Summit Home Loans", "Mortgage", "mortgage", null, "0010");
  const accounts = [jointChecking, janeChecking, johnChecking, johnCard, janeCard, savings, johnSavings, janeSavings, brokerage, retirement, home, mortgage];

  const categories: CategoryRow[] = [];
  const categoryLookup = new Map<
    string,
    { categoryId: string; subcategoryId: string; expenseType: ExpenseType | null }
  >();
  DEFAULT_CATEGORIES.forEach((category, categoryIndex) => {
    const categoryId = uuid();
    categories.push({
      id: categoryId,
      household_id: household.id,
      parent_id: null,
      name: category.name,
      default_expense_type: null,
      sort_order: categoryIndex,
      is_active: true,
      created_at: createdAt,
    });
    category.subcategories.forEach((subcategory, subcategoryIndex) => {
      const subcategoryId = uuid();
      categories.push({
        id: subcategoryId,
        household_id: household.id,
        parent_id: categoryId,
        name: subcategory.name,
        default_expense_type: subcategory.expenseType,
        sort_order: subcategoryIndex,
        is_active: true,
        created_at: createdAt,
      });
      categoryLookup.set(`${category.name}/${subcategory.name}`, {
        categoryId,
        subcategoryId,
        expenseType: subcategory.expenseType,
      });
    });
  });

  const transactions: TransactionRow[] = [];
  const needsReviewFrom = addDays(endDate, -13);
  const currentWeekFrom = weekRange(endDate, WEEK_STARTS_ON).from;

  const add = (entry: Entry) => {
    const type = entry.type ?? "expense";
    const isRecent = entry.date >= needsReviewFrom;
    let categoryPath = entry.category;
    let status: TransactionRow["review_status"] =
      entry.date >= currentWeekFrom ? "auto_categorized" : "reviewed";
    let confidence: TransactionRow["categorization_confidence"] = "high";
    let reason =
      entry.reason ??
      (countsAsSpending({ transaction_type: type }) ? "Matched a merchant rule" : "Recognized by transaction type");

    if (entry.unknown && isRecent) {
      categoryPath = undefined;
      status = "needs_review";
      confidence = "low";
      reason = "New merchant";
    } else if (entry.unknown) {
      categoryPath = "Other/Miscellaneous";
      confidence = null;
      reason = "Chosen during review";
    } else if (entry.uncertain && isRecent) {
      status = "needs_review";
      confidence = "medium";
      reason = "This merchant's purchases vary";
    }

    const category = categoryPath ? categoryLookup.get(categoryPath) : undefined;
    if (categoryPath && !category) throw new Error(`Unknown seed category: ${categoryPath}`);
    const isCard = entry.account.account_type === "credit_card";

    transactions.push({
      id: uuid(),
      household_id: household.id,
      account_id: entry.account.id,
      person_id: entry.person,
      transaction_date: entry.date,
      posting_date: isCard ? addDays(entry.date, 1) : entry.date,
      original_description: entry.description,
      normalized_merchant: entry.merchant,
      amount: entry.amount,
      transaction_type: type,
      counterparty_id: entry.counterparty ?? null,
      category_id: category?.categoryId ?? null,
      subcategory_id: category?.subcategoryId ?? null,
      expense_type: category?.expenseType ?? null,
      is_recurring: entry.recurring ?? false,
      is_transfer: isTransferType(type),
      review_status: status,
      categorization_confidence: confidence,
      categorization_reason: reason,
      notes: null,
      source_file: entry.awaitingPost ? "Added by hand" : "synthetic-seed",
      source_hash: null,
      bank_category: null,
      is_manual: entry.awaitingPost ?? false,
      awaiting_post: entry.awaitingPost ?? false,
      is_private: entry.privateUntil !== undefined,
      private_until: entry.privateUntil ?? null,
      created_at: createdAt,
      updated_at: createdAt,
    });
  };

  const john = { id: johnId, card: johnCard };
  const jane = { id: janeId, card: janeCard };
  const eitherPerson = () => (chance(0.5) ? john : jane);

  /** A purchase on the buyer's own credit card. */
  const purchase = (
    date: string,
    who: { id: string; card: AccountRow },
    description: string,
    merchant: string,
    amount: number,
    category: string,
    extra: Partial<Entry> = {},
  ) =>
    add({
      date,
      account: who.card,
      person: who.id,
      description,
      merchant,
      amount: -amount,
      category,
      ...extra,
    });

  const firstMonth = addMonths(monthKey(endDate), -(months - 1));
  const startDate = `${firstMonth}-01`;
  const totalDays = daysBetween(startDate, endDate);
  const storeNumber = () => String(1000 + Math.floor(random() * 9000));

  for (let offset = 0; offset <= totalDays; offset++) {
    const date = addDays(startDate, offset);
    const day = Number(date.slice(8));
    const monthIndex = (Number(date.slice(0, 4)) - Number(firstMonth.slice(0, 4))) * 12 +
      (Number(date.slice(5, 7)) - Number(firstMonth.slice(5, 7)));
    const sincePayday = ((daysBetween(PAYDAY_ANCHOR, date) % 14) + 14) % 14;
    const calendarMonth = date.slice(5, 7);

    // --- Income -----------------------------------------------------------
    if (sincePayday === 0) {
      add({ date, account: johnChecking, person: johnId, description: "ACME CORP PAYROLL PPD", merchant: "Acme Corp Payroll", amount: 3150, type: "income", recurring: true });
    }
    if (sincePayday === 7) {
      add({ date, account: janeChecking, person: janeId, description: "NORTHSIDE HEALTH DIR DEP", merchant: "Northside Health Payroll", amount: 2780, type: "income", recurring: true });
    }

    // --- Fixed monthly bills ----------------------------------------------
    if (day === 1) {
      add({ date, account: jointChecking, person: null, description: "SUMMIT HOME LOANS MTG PYMT", merchant: "Summit Home Loans", amount: -2450, category: "Housing/Mortgage", recurring: true });
    }
    if (day === 2) {
      // Each person pays into the joint account that covers the shared bills.
      add({ date, account: johnChecking, person: johnId, description: "JOINT ACCOUNT PAYMENT ID 9X2 ZELLE PAYMENT TO", merchant: "Zelle · Joint Account", amount: -1900, type: "transfer", recurring: true });
      add({ date, account: jointChecking, person: null, counterparty: johnId, description: "ZELLE PAYMENT FROM SAM RIVERA CONF# 1", merchant: "Zelle · Sam Roe", amount: 1900, type: "transfer", recurring: true });
      add({ date, account: janeChecking, person: janeId, description: "ZELLE PAYMENT TO JOINT ACCOUNT", merchant: "Zelle · Joint Account", amount: -1500, type: "transfer", recurring: true });
      add({ date, account: jointChecking, person: null, counterparty: janeId, description: "ZELLE PAYMENT FROM JANE DOE CONF# 2", merchant: "Zelle · Jane Doe", amount: 1500, type: "transfer", recurring: true });
    }
    if (day === 3) {
      add({ date, account: jointChecking, person: null, description: "OAKWOOD COMMONS HOA DUES", merchant: "Oakwood Commons HOA", amount: -285, category: "Housing/HOA", recurring: true });
    }
    if (day === 5) {
      add({ date, account: janeChecking, person: janeId, description: "BRIGHTLINE INTERNET AUTOPAY", merchant: "Brightline Internet", amount: -49.99, category: "Housing/Internet", recurring: true });
    }
    if (day === 7) purchase(date, jane, "NETFLIX.COM", "Netflix", 19.99, "Subscriptions/Streaming", { recurring: true });
    if (day === 8) purchase(date, john, "PLANET FITNESS CLUB FEES", "Planet Fitness", 25, "Health & Wellness/Gym", { recurring: true });
    if (day === 9) purchase(date, john, "PEACOCK 8F2A1 PREMIUM", "Peacock", 11, "Subscriptions/Streaming", { recurring: true });
    if (day === 10) purchase(date, jane, "CHEWY.COM AUTOSHIP", "Chewy", between(55, 75), "Dog/Food", { recurring: true });
    if (day === 12) {
      add({ date, account: jointChecking, person: null, description: "CITY POWER & LIGHT BILLPAY", merchant: "City Power & Light", amount: -between(90, 170), category: "Housing/Electricity", recurring: true });
    }
    if (day === 14) purchase(date, john, "RING BASIC PLAN", "Ring", 9.99, "Subscriptions/Home Security", { recurring: true });
    if (day === 15) purchase(date, john, "GEICO *AUTO", "Geico", 142.5, "Transportation/Car Insurance", { recurring: true });
    if (day === 18) purchase(date, john, "OPENAI *CHATGPT SUBSCR", "ChatGPT", 20, "Subscriptions/AI / Software", { recurring: true });
    if (day === 20) purchase(date, john, "APPLE.COM/BILL", "Apple", 9.99, "Subscriptions/Cloud Storage", { recurring: true });
    if (day === 21) purchase(date, jane, "APPLE.COM/BILL", "Apple", 2.99, "Subscriptions/Cloud Storage", { recurring: true });
    if (day === 22) purchase(date, john, "AMAZON PRIME*2R4TY81X3", "Amazon Prime", 14.99, "Subscriptions/Other Subscriptions", { recurring: true });

    // --- Money moving between our own accounts (never spending) -------------
    if (day === 2) {
      add({ date, account: jointChecking, person: null, description: "ONLINE TRANSFER TO SAVINGS", merchant: "Transfer to Savings", amount: -500, type: "transfer", recurring: true });
      add({ date, account: savings, person: null, description: "ONLINE TRANSFER FROM CHECKING", merchant: "Transfer from Checking", amount: 500, type: "transfer", recurring: true });
    }
    if (day === 16) {
      add({ date, account: johnChecking, person: johnId, description: "VANGUARD BUY INVESTMENT", merchant: "Vanguard", amount: -400, type: "investment_contribution", recurring: true });
      add({ date, account: brokerage, person: johnId, description: "ELECTRONIC BANK TRANSFER", merchant: "Contribution", amount: 400, type: "investment_contribution", recurring: true });
    }
    if (day === 26) {
      // Jane pays John back for her share of groceries he put on his card.
      const share = between(120, 220);
      add({ date, account: janeChecking, person: janeId, counterparty: johnId, description: "ZELLE PAYMENT TO SAM RIVERA", merchant: "Zelle · Sam Roe", amount: -share, type: "reimbursement", category: "Food/Groceries" });
      add({ date, account: johnChecking, person: johnId, counterparty: janeId, description: "ZELLE PAYMENT FROM JANE DOE", merchant: "Zelle · Jane Doe", amount: share, type: "reimbursement", category: "Food/Groceries" });
    }
    if (day === 28) {
      add({ date, account: savings, person: null, description: "INTEREST PAYMENT", merchant: "Savings Interest", amount: between(3, 5), type: "income", recurring: true });
    }
    // Personal savings and investing, from each person's own checking.
    if (sincePayday === 1) {
      add({ date, account: johnChecking, person: johnId, description: "ONLINE TRANSFER TO SAV 4821", merchant: "Transfer to Savings", amount: -300, type: "transfer", recurring: true });
      add({ date, account: johnSavings, person: johnId, description: "ONLINE TRANSFER FROM CHK 3307", merchant: "Transfer from Checking", amount: 300, type: "transfer", recurring: true });
    }
    if (day === 9) {
      add({ date, account: janeChecking, person: janeId, description: "Online Banking transfer to SAV 7314", merchant: "Transfer to Savings", amount: -400, type: "transfer", recurring: true });
      add({ date, account: janeSavings, person: janeId, description: "Online Banking transfer from CHK 2210", merchant: "Transfer from Checking", amount: 400, type: "transfer", recurring: true });
    }
    if (day === 20 && monthIndex % 3 === 2) {
      // Some taken back out now and then, so savings show as a net figure.
      add({ date, account: janeChecking, person: janeId, description: "Online Banking transfer from SAV 7314", merchant: "Transfer from Savings", amount: 250, type: "transfer" });
      add({ date, account: janeSavings, person: janeId, description: "Online Banking transfer to CHK 2210", merchant: "Transfer to Checking", amount: -250, type: "transfer" });
    }
    if (day === 20) {
      add({ date, account: janeChecking, person: janeId, description: "FIDELITY ROTH IRA CONTRIB", merchant: "Fidelity", amount: -250, type: "investment_contribution", recurring: true });
      add({ date, account: retirement, person: janeId, description: "ROTH IRA CONTRIBUTION", merchant: "Contribution", amount: 250, type: "investment_contribution", recurring: true });
    }

    // --- Everyday variable spending -----------------------------------------
    if (chance(0.3)) {
      const store = pick([
        ["TRADER JOE S #", "Trader Joe's"],
        ["SAFEWAY #", "Safeway"],
        ["WHOLEFDS MKT #", "Whole Foods"],
        ["COSTCO WHSE #", "Costco"],
      ]);
      purchase(date, eitherPerson(), `${store[0]}${storeNumber()}`, store[1], between(35, 160), "Food/Groceries");
    }
    if (chance(0.4)) {
      const place = pick([
        ["SQ *CHIPOTLE ", "Chipotle"],
        ["CAVA GRILL ", "Cava"],
        ["TST* THE LOCAL TAVERN ", "The Local Tavern"],
        ["SWEETGREEN ", "Sweetgreen"],
        ["OLIVE GARDEN ", "Olive Garden"],
      ]);
      purchase(date, eitherPerson(), `${place[0]}${storeNumber()}`, place[1], between(12, 85), "Food/Restaurants");
    }
    if (chance(0.08)) {
      purchase(date, eitherPerson(), "DOORDASH*THAI HOUSE", "DoorDash", between(22, 55), "Food/Delivery");
    }
    if (chance(0.3)) {
      purchase(date, eitherPerson(), `STARBUCKS STORE ${storeNumber()}`, "Starbucks", between(4.5, 9), "Food/Coffee");
    }
    if (chance(0.12)) {
      const station = pick([
        ["SHELL OIL ", "Shell"],
        ["EXXON ", "Exxon"],
      ]);
      purchase(date, eitherPerson(), `${station[0]}${storeNumber()}`, station[1], between(32, 58), "Transportation/Gas");
    }
    if (chance(0.1)) purchase(date, john, "METRO TRANSIT FARE RELOAD", "Metro Transit", pick([10, 20]), "Transportation/Metro");
    if (chance(0.04)) purchase(date, eitherPerson(), "PARKMOBILE", "ParkMobile", between(3, 18), "Transportation/Parking");
    if (chance(0.12)) {
      const who = eitherPerson();
      if (chance(0.6)) {
        purchase(date, who, `AMZN MKTP US*${storeNumber()}XK2`, "Amazon", between(12, 140), "Personal/Shopping", { uncertain: chance(0.5) });
      } else {
        purchase(date, who, `TARGET 0000${storeNumber()}`, "Target", between(15, 120), "Personal/Shopping");
      }
    }
    if (chance(0.07)) {
      const shop = pick([
        ["STEAMGAMES.COM", "Steam"],
        ["TOPGOLF", "Topgolf"],
      ]);
      purchase(date, john, shop[0], shop[1], between(15, 70), "Personal/Play Money");
    }
    if (chance(0.07)) {
      const shop = pick([
        ["SEPHORA.COM", "Sephora"],
        ["TJ MAXX #0482", "TJ Maxx"],
      ]);
      purchase(date, jane, shop[0], shop[1], between(15, 70), "Personal/Play Money");
    }
    if (chance(0.05)) purchase(date, eitherPerson(), "AMC THEATRES ONLINE", "AMC Theatres", between(14, 48), "Personal/Entertainment");
    if (chance(0.04)) purchase(date, jane, "PETSMART #" + storeNumber(), "PetSmart", between(12, 45), "Dog/Supplies");
    if (chance(0.04)) purchase(date, jane, "SQ *LUNA NAIL STUDIO", "Luna Nail Studio", between(35, 70), "Health & Wellness/Personal Care");
    if (chance(0.03)) purchase(date, eitherPerson(), `CVS/PHARMACY #${storeNumber()}`, "CVS Pharmacy", between(8, 60), "Health & Wellness/Medical");
    if (chance(0.02)) purchase(date, eitherPerson(), "ETSY.COM - GIFTSHOP", "Etsy", between(20, 90), "Gifts/Gifts");
    if (chance(0.03)) {
      const mystery = pick([
        ["VENMO *SAM R", "Venmo · Sam R"],
        ["SQ *K&M ENTERPRISES", "K&M Enterprises"],
        ["PAYPAL *XJ29 MARKET", "PayPal"],
      ]);
      purchase(date, eitherPerson(), mystery[0], mystery[1], between(15, 120), "Other/Miscellaneous", { unknown: true });
    }

    // --- Occasional / irregular ---------------------------------------------
    if (day === 13) {
      add({ date, account: johnCard, person: johnId, description: "AMZN MKTP US REFUND", merchant: "Amazon", amount: between(15, 60), type: "refund", category: "Personal/Shopping" });
    }
    if (day === 17 && monthIndex % 2 === 0) purchase(date, jane, "PETSMART GROOMING", "PetSmart Grooming", 75, "Dog/Grooming");
    if (monthIndex === 1 && day === 19) purchase(date, jane, "RIVERSIDE ANIMAL HOSPITAL", "Riverside Animal Hospital", 245, "Dog/Vet");
    if (monthIndex === 4 && day === 11) purchase(date, john, "RIVERSIDE ANIMAL HOSPITAL", "Riverside Animal Hospital", 186.5, "Dog/Vet");
    if (monthIndex === 3 && day === 20) purchase(date, jane, "JIFFY LUBE #2291", "Jiffy Lube", 89.99, "Transportation/Car Maintenance");
    if (monthIndex === 2 && day === 23) purchase(date, john, "BRIGHT SMILE DENTAL", "Bright Smile Dental", 150, "Health & Wellness/Dental");
    if (monthIndex === 4 && day === 2) purchase(date, john, "AMERICAN RED CROSS DONATION", "American Red Cross", 100, "Gifts/Donations");
    if (monthIndex === 1 && day === 10) {
      // Two identical purchases on one day: legitimate, must not be deduplicated.
      purchase(date, jane, "STARBUCKS STORE 08842", "Starbucks", 5.75, "Food/Coffee");
      purchase(date, jane, "STARBUCKS STORE 08842", "Starbucks", 5.75, "Food/Coffee");
    }
    // --- Through the year ------------------------------------------------------
    if (calendarMonth === "12") {
      if (day === 6) purchase(date, jane, "TARGET 00004417", "Target", 186.4, "Gifts/Gifts");
      if (day === 11) purchase(date, john, "AMZN MKTP US*HOLIDAY", "Amazon", 248.9, "Gifts/Gifts");
      if (day === 15) purchase(date, jane, "ETSY.COM - GIFTSHOP", "Etsy", 92.5, "Gifts/Gifts");
      if (day === 19) purchase(date, john, "SOUTHWEST AIR 5262381", "Southwest Airlines", 436.8, "Travel/Flights");
    }
    if (calendarMonth === "03") {
      if (day === 4) purchase(date, john, "COSTCO *ANNUAL RENEWAL", "Costco", 65, "Subscriptions/Other Subscriptions");
      if (day === 13) {
        add({ date, account: johnChecking, person: johnId, description: "ACME CORP BONUS PPD", merchant: "Acme Corp Payroll", amount: 2400, type: "income" });
      }
    }
    if (calendarMonth === "04" && day === 17) {
      add({ date, account: janeChecking, person: janeId, description: "IRS TREAS 310 TAX REF", merchant: "IRS Tax Refund", amount: 1180, type: "income" });
    }
    if (calendarMonth === "07") {
      if (day === 8) purchase(date, jane, "UNITED AIRLINES 0162", "United Airlines", 742.6, "Travel/Flights");
      if (day === 18) purchase(date, john, "AIRBNB * HMQ4X2", "Airbnb", 1180, "Travel/Hotels");
      if (day === 20) purchase(date, jane, "SQ *HARBOR KAYAK TOURS", "Harbor Kayak Tours", 160, "Travel/Activities");
    }
    if (calendarMonth === "09" && day === 9) {
      purchase(date, john, "MIDAS AUTO SERVICE #512", "Midas", 640.25, "Transportation/Car Maintenance");
    }
    if (monthIndex === 2) {
      if (day === 6) purchase(date, john, "DELTA AIR 0062341889120", "Delta Air Lines", 612.4, "Travel/Flights");
      if (day === 14) purchase(date, jane, "MARRIOTT HARBORVIEW", "Marriott", 548.2, "Travel/Hotels");
      if (day === 14) purchase(date, john, "UBER *TRIP", "Uber", 34.18, "Travel/Transportation");
      if (day === 15) purchase(date, jane, "VIATOR TOURS", "Viator", 120, "Travel/Activities");
    }
  }

  // Always leave a few items waiting in the review queue.
  purchase(addDays(endDate, -1), john, "AMZN MKTP US*7731XK2", "Amazon", 47.21, "Personal/Shopping", { uncertain: true });
  purchase(addDays(endDate, -2), jane, "VENMO *SAM R", "Venmo · Sam R", 40, "Other/Miscellaneous", { unknown: true });
  purchase(addDays(endDate, -4), john, "SQ *K&M ENTERPRISES", "K&M Enterprises", 27.5, "Other/Miscellaneous", { unknown: true });

  // A gift Jane is keeping private from John until his birthday.
  purchase(addDays(endDate, -3), jane, "ETSY.COM - GIFTSHOP", "Etsy", 86, "Gifts/Gifts", { privateUntil: addDays(endDate, 30) });
  // Cash John wrote down himself; it will match up when the bank download shows it.
  purchase(addDays(endDate, -2), john, "Farmers market", "Farmers Market", 32.4, "Food/Groceries", { awaitingPost: true, reason: "Added by hand" });
  // A deposit into the joint account that the joint account's statement doesn't show yet.
  add({
    date: addDays(endDate, -1),
    account: johnChecking,
    person: johnId,
    counterparty: johnId,
    description: "JOINT ACCOUNT PAYMENT ID 7Q4 ZELLE PAYMENT TO",
    merchant: "Zelle · Joint Account",
    amount: -250,
    type: "transfer",
    reason: "Your usual deposit into the shared account; the joint account's statement doesn't show it yet",
  });

  // --- Credit card payments: pay last month's card spending on the 25th -----
  const cardPayments = [
    { card: johnCard, from: johnChecking, person: johnId, firstMonthAmount: 1850 },
    { card: janeCard, from: janeChecking, person: janeId, firstMonthAmount: 1420 },
  ];
  for (let index = 0; index < months; index++) {
    const month = addMonths(firstMonth, index);
    const date = `${month}-25`;
    if (date > endDate) break;
    const previous = monthRange(addMonths(month, -1));
    for (const payment of cardPayments) {
      const previousSpendCents = transactions
        .filter(
          (t) =>
            t.account_id === payment.card.id &&
            countsAsSpending(t) &&
            t.transaction_date >= previous.from &&
            t.transaction_date <= previous.to,
        )
        .reduce((total, t) => total - toCents(t.amount), 0);
      const amount = index === 0 ? payment.firstMonthAmount : previousSpendCents / 100;
      if (amount <= 0) continue;
      const cardName = `${payment.card.institution} Card Payment`;
      add({ date, account: payment.from, person: payment.person, description: `${payment.card.institution.toUpperCase()} CREDIT CRD AUTOPAY`, merchant: cardName, amount: -amount, type: "credit_card_payment", recurring: true });
      add({ date, account: payment.card, person: payment.person, description: "PAYMENT THANK YOU", merchant: cardName, amount, type: "credit_card_payment", recurring: true });
    }
  }

  transactions.sort(
    (a, b) => b.transaction_date.localeCompare(a.transaction_date) || a.id.localeCompare(b.id),
  );

  const rules: CategorizationRuleRow[] = defaultRuleRows(categories).map((rule) => ({
    ...rule,
    id: uuid(),
    household_id: household.id,
    created_at: createdAt,
    updated_at: createdAt,
  }));

  // A starter plan: household-wide, per person, and the shared account.
  const budget = (
    scope: BudgetLineRow["scope"],
    person: string | null,
    path: string,
    kind: BudgetLineRow["kind"],
    amount: number,
    wholeCategory = false,
  ): BudgetLineRow => {
    const target = categoryLookup.get(path);
    if (!target) throw new Error(`Unknown seed category: ${path}`);
    return {
      id: uuid(),
      household_id: household.id,
      scope,
      person_id: person,
      category_id: target.categoryId,
      subcategory_id: wholeCategory ? null : target.subcategoryId,
      kind,
      amount,
      starts_month: `${firstMonth}-01`,
      ends_month: null,
      created_at: createdAt,
    };
  };
  const budgets: BudgetLineRow[] = [
    budget("everyone", null, "Food/Groceries", "variable", 900),
    budget("everyone", null, "Food/Restaurants", "variable", 450),
    budget("everyone", null, "Food/Coffee", "variable", 120),
    budget("everyone", null, "Transportation/Gas", "variable", 250),
    budget("everyone", null, "Dog/Food", "variable", 200, true),
    budget("everyone", null, "Subscriptions/Streaming", "fixed", 120, true),
    budget("everyone", null, "Travel/Flights", "sinking_fund", 300, true),
    budget("everyone", null, "Gifts/Gifts", "sinking_fund", 100, true),
    budget("person", johnId, "Personal/Play Money", "allowance", 300),
    budget("person", janeId, "Personal/Play Money", "allowance", 300),
    budget("shared", null, "Housing/Mortgage", "fixed", 2450),
    budget("shared", null, "Housing/HOA", "fixed", 285),
    budget("shared", null, "Housing/Electricity", "variable", 160),
  ];

  // Month-end balances, as if entered at the end of each month.
  const balances: AccountBalanceRow[] = [];
  const startingValues: [AccountRow, number, number][] = [
    // account, value at the first month end, change per month
    [jointChecking, 3200, 40],
    [johnChecking, 4100, 180],
    [janeChecking, 3600, 150],
    [savings, 18000, 500],
    [johnSavings, 6200, 650],
    [janeSavings, 9400, 320],
    [brokerage, 24000, 650],
    [retirement, 41000, 900],
    [home, 520000, 1200],
    [mortgage, 412000, -900],
    [johnCard, 1850, 0],
    [janeCard, 1420, 0],
  ];
  for (let index = 0; index < months; index++) {
    const month = addMonths(firstMonth, index);
    const asOf = index === months - 1 ? endDate : monthRange(month).to;
    for (const [target, start, change] of startingValues) {
      const wobble = target.account_type === "credit_card" ? between(-400, 400) : between(-0.03, 0.03) * start;
      balances.push({
        id: uuid(),
        household_id: household.id,
        account_id: target.id,
        as_of: asOf,
        balance: Math.round((start + change * index + wobble) * 100) / 100,
        source: "manual",
        created_at: createdAt,
      });
    }
  }

  // Expected paychecks, so the forecast knows what's coming.
  const paycheck = (person: string, name: string, amount: number, anchor: string): IncomeSourceRow => ({
    id: uuid(),
    household_id: household.id,
    person_id: person,
    name,
    amount,
    frequency: "biweekly",
    anchor_date: anchor,
    second_day: null,
    is_active: true,
    created_at: createdAt,
  });
  const incomeSources = [
    paycheck(johnId, "Acme Corp paycheck", 3150, PAYDAY_ANCHOR),
    paycheck(janeId, "Northside Health paycheck", 2780, addDays(PAYDAY_ANCHOR, 7)),
  ];

  return { household, members, accounts, categories, rules, budgets, balances, incomeSources, transactions };
}
