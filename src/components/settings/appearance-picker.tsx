"use client";

import { useState } from "react";
import {
  COOKIE_MAX_AGE,
  MODE_COOKIE,
  MODES,
  THEME_COOKIE,
  THEMES,
  type Mode,
  type Theme,
} from "@/lib/appearance";

function save(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

/**
 * Theme and light/dark choice for this device. Changes apply at once (on the
 * <html> element) and are remembered in a cookie the server reads next time.
 */
export function AppearancePicker({ theme: initialTheme, mode: initialMode }: { theme: Theme; mode: Mode }) {
  const [theme, setTheme] = useState(initialTheme);
  const [mode, setMode] = useState(initialMode);

  const chooseTheme = (next: Theme) => {
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    save(THEME_COOKIE, next);
  };
  const chooseMode = (next: Mode) => {
    setMode(next);
    document.documentElement.setAttribute("data-mode", next);
    save(MODE_COOKIE, next);
  };

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Theme</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {THEMES.map((option) => {
            const selected = option.id === theme;
            return (
              <label
                key={option.id}
                className={`cursor-pointer rounded-xl border p-2 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${
                  selected ? "border-accent ring-1 ring-accent" : "border-line hover:border-muted"
                }`}
              >
                <input
                  type="radio"
                  name="theme"
                  value={option.id}
                  checked={selected}
                  onChange={() => chooseTheme(option.id)}
                  className="sr-only"
                />
                {/* a small preview, drawn in that theme's own colors */}
                <span
                  data-theme={option.id}
                  aria-hidden="true"
                  className="flex h-16 gap-1.5 rounded-lg border border-line bg-bg p-1.5"
                >
                  <span className="w-1/4 rounded-md bg-surface p-1">
                    <span className="block h-1.5 rounded-full bg-accent" />
                    <span className="mt-1 block h-1.5 w-2/3 rounded-full bg-line" />
                  </span>
                  <span className="flex-1 rounded-md bg-surface p-1.5">
                    <span className="block h-2 w-1/2 rounded-full bg-text/80" />
                    <span className="mt-1.5 block h-1.5 w-3/4 rounded-full bg-accent-soft" />
                    <span className="mt-1.5 block h-1.5 w-1/3 rounded-full bg-accent" />
                  </span>
                </span>
                <span className="mt-2 block px-1 text-sm font-medium">{option.label}</span>
                <span className="block px-1 text-xs text-muted">{option.hint}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Light or dark</legend>
        <div className="flex gap-1 rounded-xl border border-line bg-surface p-1 sm:inline-flex">
          {MODES.map((option) => {
            const selected = option.id === mode;
            return (
              <label
                key={option.id}
                className={`flex-1 cursor-pointer rounded-lg px-4 py-1.5 text-center text-sm font-medium sm:flex-none ${
                  selected ? "bg-accent-soft text-accent" : "text-muted hover:text-text"
                } has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent`}
              >
                <input
                  type="radio"
                  name="mode"
                  value={option.id}
                  checked={selected}
                  onChange={() => chooseMode(option.id)}
                  className="sr-only"
                />
                {option.label}
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted">
          Saved on this device only, so each of you can pick your own. Auto follows the device&apos;s light or dark
          setting.
        </p>
      </fieldset>
    </div>
  );
}
