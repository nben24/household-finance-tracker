import type { RuleMatchType } from "@/lib/db/types";
import { MERCHANT_LIBRARY } from "@/lib/import/merchant-library";

export interface DefaultRule {
  matchType: RuleMatchType;
  /** lowercased */
  pattern: string;
  /** "Category/Subcategory" from DEFAULT_CATEGORIES */
  path: string;
  /** false = suggest only; the transaction still goes to review */
  auto: boolean;
}

const bank = (path: string, auto: boolean, labels: string[]): DefaultRule[] =>
  labels.map((label) => ({ matchType: "bank_category", pattern: label.toLowerCase(), path, auto }));

// Merchant rules come from the merchant library, so the names always match
// what the importer produces.
export const DEFAULT_RULES: DefaultRule[] = [
  ...MERCHANT_LIBRARY.filter((merchant) => merchant.path !== null).map(
    (merchant): DefaultRule => ({
      matchType: "merchant",
      pattern: merchant.name.toLowerCase(),
      path: merchant.path!,
      auto: merchant.auto,
    }),
  ),

  { matchType: "description", pattern: "atm", path: "Personal/Cash", auto: true },
  { matchType: "description", pattern: "atm fee", path: "Other/Bank Fees", auto: true },
  { matchType: "description", pattern: "mortgage", path: "Housing/Mortgage", auto: true },
  { matchType: "description", pattern: "hoa", path: "Housing/HOA", auto: false },

  // American Express "Category" column
  ...bank("Food/Groceries", true, ["Merchandise & Supplies-Groceries"]),
  ...bank("Food/Groceries", false, ["Merchandise & Supplies-Wholesale Stores"]),
  ...bank("Food/Restaurants", true, ["Restaurant-Restaurant"]),
  // Amex uses "Bar & Café" for most fast food, not just coffee shops.
  ...bank("Food/Restaurants", false, ["Restaurant-Bar & Café"]),
  ...bank("Transportation/Gas", true, ["Transportation-Fuel"]),
  ...bank("Transportation/Parking", true, ["Transportation-Parking Charges"]),
  ...bank("Transportation/Tolls", true, ["Transportation-Tolls & Fees"]),
  ...bank("Transportation/Other Transportation", false, ["Transportation-Taxis & Coach"]),
  ...bank("Personal/Shopping", false, [
    "Merchandise & Supplies-Clothing Stores",
    "Merchandise & Supplies-Department Stores",
    "Merchandise & Supplies-General Retail",
    "Merchandise & Supplies-Internet Purchase",
    "Merchandise & Supplies-Computer Supplies",
  ]),
  ...bank("Personal/Entertainment", false, ["Entertainment-General Events", "Entertainment-Associations"]),
  ...bank("Housing/Internet", false, ["Communications-Cable & Internet Comm"]),
  ...bank("Housing/Electricity", false, ["Other-Utilities"]),
  ...bank("Subscriptions/Other Subscriptions", false, ["Business Services-Internet Services"]),
  ...bank("Personal/Hobbies", false, ["Merchandise & Supplies-Sporting Goods Stores"]),
  ...bank("Personal/Entertainment", true, ["Entertainment-Theatrical Events"]),
  ...bank("Personal/Other Personal", false, ["Other-Education"]),
  ...bank("Housing/Other Housing", false, ["Merchandise & Supplies-Hardware Supplies", "Merchandise & Supplies-Furnishing"]),
  ...bank("Travel/Transportation", false, ["Transportation-Rail Services"]),
  ...bank("Other/Miscellaneous", false, ["Other-Government Services", "Other-Miscellaneous"]),

  // Truist "Category name / Sub-category name" columns
  ...bank("Personal/Cash", true, ["Cash & Checks / Cash withdrawals"]),
  ...bank("Food/Coffee", true, ["Dining & Entertainment / Cafes & coffee shops"]),
  ...bank("Other/Bank Fees", true, ["Taxes & Fees / ATM fees"]),
  ...bank("Subscriptions/Streaming", false, ["Dining & Entertainment / Digital entertainment"]),
  ...bank("Personal/Play Money", false, ["Dining & Entertainment / Gambling"]),
  ...bank("Housing/Electricity", false, ["Utilities / Other utilities"]),
];
