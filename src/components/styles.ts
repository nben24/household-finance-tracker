// Shared class names for controls, so every page's buttons, fields and
// segmented choices look and behave the same. Usable from server and client
// components alike. Keyboard focus comes from the global :focus-visible rule
// in globals.css, so none of these remove the outline.

/** Text fields, selects and date inputs. */
export const inputClass =
  "min-h-10 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text focus:border-accent";

/** The one main action in a section. */
export const primaryButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-surface hover:opacity-90 disabled:opacity-50";

/** Other actions next to a primary one. */
export const secondaryButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-text hover:bg-bg disabled:opacity-50";

/** Compact actions inside lists and cards. */
export const smallButton =
  "inline-flex min-h-9 items-center justify-center rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-text hover:bg-bg disabled:opacity-50";

/** A quiet text-style action. */
export const linkButton = "inline-flex min-h-9 items-center text-sm font-medium text-accent hover:underline disabled:opacity-50";

/** Container of a segmented choice (Month / Week, This month / Next month…). */
export const segmentedClass = "inline-flex rounded-xl border border-line bg-surface p-1";

/** One option of a segmented choice. */
export function segmentClass(selected: boolean): string {
  return `inline-flex min-h-9 items-center justify-center rounded-lg px-3 text-sm font-medium ${
    selected ? "bg-accent-soft text-accent" : "text-muted hover:text-text"
  }`;
}

/** A selectable chip (review choices, quick categories). Pair with aria-pressed. */
export function chipClass(selected: boolean): string {
  return `inline-flex min-h-9 items-center rounded-full border px-3 py-1 text-sm font-medium ${
    selected ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-text"
  }`;
}

/** Field label wrapper text. */
export const labelClass = "text-sm font-medium text-text";
/** Help text under a field or section. */
export const hintClass = "text-[13px] leading-snug text-muted";
