"use client";

import { useState } from "react";
import { addDefaults, addRule, applyRules, deleteRule, recheckExisting, updateRule } from "@/app/(app)/settings/actions";
import type { CategoryGroup } from "@/components/review/review-card";
import type { CategorizationRuleRow, RuleMatchType, RuleSource } from "@/lib/db/types";
import { Feedback, inputClass, primaryButton, smallButton, useSettingsAction } from "./use-settings-action";

const MATCH_LABELS: Record<RuleMatchType, string> = {
  merchant: "Merchant is",
  description: "Description contains",
  bank_category: "Bank's category is",
};

const SOURCE_LABELS: Record<RuleSource, string> = {
  default: "Built in",
  learned: "Learned from review",
  manual: "Added by you",
  ai: "Suggested by AI",
};

function CategorySelect({
  groups,
  value,
  onChange,
  disabled,
}: {
  groups: CategoryGroup[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      aria-label="Category"
      className={`${inputClass} w-full py-1.5`}
    >
      <option value="">Choose a category…</option>
      {groups.map((group) => (
        <optgroup key={group.id} label={group.name}>
          {group.children.map((child) => (
            <option key={child.id} value={child.id}>
              {child.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function ModeSelect({ value, onChange, disabled }: { value: boolean; onChange: (auto: boolean) => void; disabled?: boolean }) {
  return (
    <select
      value={value ? "auto" : "suggest"}
      onChange={(event) => onChange(event.target.value === "auto")}
      disabled={disabled}
      aria-label="What happens"
      className={`${inputClass} py-1.5`}
    >
      <option value="auto">Sort automatically</option>
      <option value="suggest">Suggest, but ask</option>
    </select>
  );
}

export function RuleManager({
  rules,
  groups,
  readOnly,
}: {
  rules: CategorizationRuleRow[];
  groups: CategoryGroup[];
  readOnly: boolean;
}) {
  const { pending, error, message, run } = useSettingsAction();
  const [matchType, setMatchType] = useState<RuleMatchType>("merchant");
  const [pattern, setPattern] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [autoApply, setAutoApply] = useState(true);
  const [filter, setFilter] = useState("");

  const labels = new Map(
    groups.flatMap((group) => group.children.map((child) => [child.id, `${group.name} › ${child.name}`] as const)),
  );
  const needle = filter.trim().toLowerCase();
  const shown = rules.filter(
    (rule) =>
      !needle ||
      rule.pattern.includes(needle) ||
      (labels.get(rule.subcategory_id) ?? "").toLowerCase().includes(needle),
  );

  return (
    <div>
      {!readOnly && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run(() => addRule({ matchType, pattern, subcategoryId, autoApply }), () => setPattern(""));
          }}
          className="grid gap-2 sm:grid-cols-[auto_1fr] lg:grid-cols-[auto_1fr_1fr_auto_auto]"
        >
          <select
            value={matchType}
            onChange={(event) => setMatchType(event.target.value as RuleMatchType)}
            aria-label="Match on"
            className={`${inputClass} py-1.5`}
          >
            {(Object.keys(MATCH_LABELS) as RuleMatchType[]).map((type) => (
              <option key={type} value={type}>
                {MATCH_LABELS[type]}
              </option>
            ))}
          </select>
          <input
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            placeholder={matchType === "merchant" ? "e.g. Giant" : matchType === "description" ? "e.g. vet" : "e.g. Restaurant-Restaurant"}
            maxLength={100}
            aria-label="Text to match"
            className={`${inputClass} py-1.5`}
          />
          <CategorySelect groups={groups} value={subcategoryId} onChange={setSubcategoryId} />
          <ModeSelect value={autoApply} onChange={setAutoApply} />
          <button type="submit" disabled={pending || !pattern.trim() || !subcategoryId} className={primaryButton}>
            Add rule
          </button>
        </form>
      )}

      {!readOnly && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => run(applyRules)} disabled={pending} className={smallButton}>
            Sort waiting transactions now
          </button>
          <button type="button" onClick={() => run(addDefaults)} disabled={pending} className={smallButton}>
            Add any missing built-in rules and categories
          </button>
          <button type="button" onClick={() => run(recheckExisting)} disabled={pending} className={smallButton}>
            Re-check existing transactions
          </button>
        </div>
      )}
      <Feedback error={error} message={message} />

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {rules.length} {rules.length === 1 ? "rule" : "rules"}
        </p>
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Find a rule"
          className={`${inputClass} py-1.5`}
        />
      </div>

      <ul className="mt-2 divide-y divide-line">
        {shown.map((rule) => (
          <li key={rule.id} className="grid gap-2 py-3 text-sm lg:grid-cols-[1fr_1fr_auto_auto] lg:items-center">
            <div>
              <span className="text-muted">{MATCH_LABELS[rule.match_type]} </span>
              <span className="font-medium">“{rule.pattern}”</span>
              <span className="block text-xs text-muted">{SOURCE_LABELS[rule.source]}</span>
            </div>
            {readOnly ? (
              <span>{labels.get(rule.subcategory_id) ?? "Hidden category"}</span>
            ) : (
              <CategorySelect
                groups={groups}
                value={labels.has(rule.subcategory_id) ? rule.subcategory_id : ""}
                disabled={pending}
                onChange={(value) => value && run(() => updateRule({ id: rule.id, subcategoryId: value }))}
              />
            )}
            {readOnly ? (
              <span className="text-muted">{rule.auto_apply ? "Sort automatically" : "Suggest, but ask"}</span>
            ) : (
              <ModeSelect
                value={rule.auto_apply}
                disabled={pending}
                onChange={(auto) => run(() => updateRule({ id: rule.id, autoApply: auto }))}
              />
            )}
            {!readOnly && (
              <button type="button" onClick={() => run(() => deleteRule(rule.id))} disabled={pending} className={smallButton}>
                Remove
              </button>
            )}
          </li>
        ))}
        {shown.length === 0 && <li className="py-3 text-sm text-muted">No rules match.</li>}
      </ul>
    </div>
  );
}
