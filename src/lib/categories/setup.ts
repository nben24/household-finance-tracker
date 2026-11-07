import type { CategorizationRuleRow, CategoryRow } from "@/lib/db/types";
import { DEFAULT_CATEGORIES } from "./defaults";
import { DEFAULT_RULES } from "./default-rules";

type NewRule = Pick<
  CategorizationRuleRow,
  "match_type" | "pattern" | "category_id" | "subcategory_id" | "auto_apply" | "source"
>;

/** Finds "Category/Subcategory" (top-level names never contain a slash) among a household's categories (case-insensitive). */
export function findByPath(
  categories: Pick<CategoryRow, "id" | "name" | "parent_id">[],
  path: string,
): { categoryId: string; subcategoryId: string } | null {
  // Split on the first slash only: subcategory names may contain one ("AI / Software").
  const slash = path.indexOf("/");
  const parentName = path.slice(0, slash).toLowerCase();
  const childName = path.slice(slash + 1).toLowerCase();
  const parent = categories.find((c) => c.parent_id === null && c.name.toLowerCase() === parentName);
  const child = parent && categories.find((c) => c.parent_id === parent.id && c.name.toLowerCase() === childName);
  return parent && child ? { categoryId: parent.id, subcategoryId: child.id } : null;
}

/** Default rules for a household, skipping any whose category was renamed or removed. */
export function defaultRuleRows(categories: Pick<CategoryRow, "id" | "name" | "parent_id">[]): NewRule[] {
  return DEFAULT_RULES.flatMap((rule) => {
    const target = findByPath(categories, rule.path);
    if (!target) return [];
    return [
      {
        match_type: rule.matchType,
        pattern: rule.pattern,
        category_id: target.categoryId,
        subcategory_id: target.subcategoryId,
        auto_apply: rule.auto,
        source: "default" as const,
      },
    ];
  });
}

/**
 * Default categories a household doesn't have yet, as parent/child pairs.
 * Lets a household created before a default was added pick it up.
 */
export interface MissingCategory {
  parentName: string;
  name: string;
  expenseType: CategoryRow["default_expense_type"];
  sortOrder: number;
}

export function missingDefaultCategories(
  categories: Pick<CategoryRow, "id" | "name" | "parent_id">[],
): MissingCategory[] {
  const missing: MissingCategory[] = [];
  for (const parent of DEFAULT_CATEGORIES) {
    parent.subcategories.forEach((child, index) => {
      if (!findByPath(categories, `${parent.name}/${child.name}`)) {
        missing.push({ parentName: parent.name, name: child.name, expenseType: child.expenseType, sortOrder: index });
      }
    });
  }
  return missing;
}
