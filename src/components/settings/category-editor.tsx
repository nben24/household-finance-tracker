"use client";

import { useState } from "react";
import { addCategory, updateCategory } from "@/app/(app)/settings/actions";
import type { CategoryRow, ExpenseType } from "@/lib/db/types";
import { EXPENSE_TYPE_LABELS } from "@/lib/labels";
import { Feedback, inputClass, smallButton, useSettingsAction } from "./use-settings-action";

function NameEditor({
  category,
  onRename,
  pending,
}: {
  category: CategoryRow;
  onRename: (name: string, done: () => void) => void;
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="text-left hover:underline" title="Rename">
        {category.name}
      </button>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onRename(name, () => setEditing(false));
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} className={`${inputClass} py-1`} autoFocus />
      <button type="submit" disabled={pending} className={smallButton}>
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} className={smallButton}>
        Cancel
      </button>
    </form>
  );
}

function AddForm({
  placeholder,
  withType,
  onAdd,
  pending,
}: {
  placeholder: string;
  withType: boolean;
  onAdd: (name: string, expenseType: string, done: () => void) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  const [expenseType, setExpenseType] = useState<ExpenseType | "">("variable");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onAdd(name, expenseType, () => setName(""));
      }}
      className="mt-2 flex flex-wrap items-center gap-2"
    >
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={placeholder}
        maxLength={40}
        className={`${inputClass} min-w-0 flex-1 py-1`}
      />
      {withType && (
        <select
          value={expenseType}
          onChange={(event) => setExpenseType(event.target.value as ExpenseType | "")}
          aria-label="Kind of expense"
          className={`${inputClass} py-1`}
        >
          {(Object.keys(EXPENSE_TYPE_LABELS) as ExpenseType[]).map((type) => (
            <option key={type} value={type}>
              {EXPENSE_TYPE_LABELS[type]}
            </option>
          ))}
          <option value="">No kind</option>
        </select>
      )}
      <button type="submit" disabled={pending || !name.trim()} className={smallButton}>
        Add
      </button>
    </form>
  );
}

export function CategoryEditor({ categories, readOnly }: { categories: CategoryRow[]; readOnly: boolean }) {
  const { pending, error, message, run } = useSettingsAction();
  const parents = categories.filter((category) => category.parent_id === null);

  const rename = (category: CategoryRow) => (name: string, done: () => void) =>
    run(() => updateCategory({ id: category.id, name }), done);
  const toggle = (category: CategoryRow) =>
    run(() => updateCategory({ id: category.id, isActive: !category.is_active }));

  return (
    <div>
      <p className="text-xs text-muted">
        Click a name to rename it. Hiding a category keeps its past transactions but removes it from the choices.
      </p>
      <Feedback error={error} message={message} />
      <div className="mt-4 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
        {parents.map((parent) => (
          <div key={parent.id} className={parent.is_active ? "" : "opacity-50"}>
            <div className="flex items-center justify-between gap-2 text-sm font-semibold">
              {readOnly ? parent.name : <NameEditor category={parent} onRename={rename(parent)} pending={pending} />}
              {!readOnly && (
                <button type="button" onClick={() => toggle(parent)} disabled={pending} className={smallButton}>
                  {parent.is_active ? "Hide" : "Show"}
                </button>
              )}
            </div>
            <ul className="mt-1.5 flex flex-col gap-1 text-sm">
              {categories
                .filter((child) => child.parent_id === parent.id)
                .map((child) => (
                  <li
                    key={child.id}
                    className={`flex items-center justify-between gap-2 text-muted ${child.is_active ? "" : "line-through opacity-60"}`}
                  >
                    {readOnly ? child.name : <NameEditor category={child} onRename={rename(child)} pending={pending} />}
                    <span className="flex items-center gap-2">
                      {child.default_expense_type && (
                        <span className="text-xs">{EXPENSE_TYPE_LABELS[child.default_expense_type]}</span>
                      )}
                      {!readOnly && (
                        <button type="button" onClick={() => toggle(child)} disabled={pending} className={smallButton}>
                          {child.is_active ? "Hide" : "Show"}
                        </button>
                      )}
                    </span>
                  </li>
                ))}
            </ul>
            {!readOnly && parent.is_active && (
              <AddForm
                placeholder={`New ${parent.name} category`}
                withType
                pending={pending}
                onAdd={(name, expenseType, done) =>
                  run(() => addCategory({ parentId: parent.id, name, expenseType }), done)
                }
              />
            )}
          </div>
        ))}
      </div>
      {!readOnly && (
        <div className="mt-6 border-t border-line pt-4">
          <p className="text-sm font-medium">Add a new top-level category</p>
          <AddForm
            placeholder="e.g. Kids"
            withType={false}
            pending={pending}
            onAdd={(name, _expenseType, done) => run(() => addCategory({ parentId: null, name, expenseType: "" }), done)}
          />
          <p className="mt-1 text-xs text-muted">Then add at least one category inside it.</p>
        </div>
      )}
      {pending && <p className="sr-only">Saving…</p>}
    </div>
  );
}
