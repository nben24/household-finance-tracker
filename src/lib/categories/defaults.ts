import type { ExpenseType } from "@/lib/db/types";

export interface DefaultCategory {
  name: string;
  subcategories: { name: string; expenseType: ExpenseType | null }[];
}

function all(expenseType: ExpenseType | null, names: string[]) {
  return names.map((name) => ({ name, expenseType }));
}

/** Starting category tree for a new household. Editable later; stored as data. */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  {
    name: "Housing",
    subcategories: [
      ...all("fixed", ["Mortgage", "HOA", "Internet"]),
      { name: "Electricity", expenseType: "variable" },
      { name: "Home Services", expenseType: "irregular" },
      { name: "Other Housing", expenseType: "variable" },
    ],
  },
  {
    name: "Food",
    subcategories: [
      { name: "Groceries", expenseType: "variable" },
      ...all("discretionary", ["Restaurants", "Delivery", "Coffee", "Snacks"]),
    ],
  },
  {
    name: "Transportation",
    subcategories: [
      ...all("variable", ["Gas", "Metro", "Parking", "Tolls"]),
      { name: "Car Insurance", expenseType: "fixed" },
      { name: "Car Maintenance", expenseType: "irregular" },
      { name: "Other Transportation", expenseType: "variable" },
    ],
  },
  {
    name: "Health & Wellness",
    subcategories: [
      ...all("irregular", ["Medical", "Dental"]),
      { name: "Gym", expenseType: "fixed" },
      { name: "Personal Care", expenseType: "variable" },
      { name: "Other Health", expenseType: "irregular" },
    ],
  },
  {
    name: "Subscriptions",
    subcategories: all("fixed", [
      "Streaming",
      "AI / Software",
      "Cloud Storage",
      "Home Security",
      "Other Subscriptions",
    ]),
  },
  {
    name: "Personal",
    subcategories: [
      ...all("discretionary", ["Shopping", "Entertainment", "Hobbies", "Play Money"]),
      { name: "Cash", expenseType: "variable" },
      { name: "Other Personal", expenseType: "discretionary" },
    ],
  },
  {
    name: "Dog",
    subcategories: [
      ...all("variable", ["Food", "Grooming"]),
      { name: "Vet", expenseType: "irregular" },
      ...all("variable", ["Supplies", "Other Dog"]),
    ],
  },
  {
    name: "Travel",
    subcategories: all("irregular", [
      "Flights",
      "Hotels",
      "Transportation",
      "Activities",
      "Other Travel",
    ]),
  },
  { name: "Gifts", subcategories: all("irregular", ["Gifts", "Donations"]) },
  {
    name: "Other",
    subcategories: [
      { name: "Miscellaneous", expenseType: null },
      { name: "Bank Fees", expenseType: "irregular" },
    ],
  },
];
