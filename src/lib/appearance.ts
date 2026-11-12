// How the app looks on this device: a color theme and light/dark mode.
// Saved in cookies (not the database), so each person picks their own on each
// device, and it works in the demo too. The colors live in globals.css.

export const THEMES = [
  { id: "evergreen", label: "Evergreen", hint: "Teal on cool gray" },
  { id: "lavender", label: "Lavender", hint: "Violet on soft lilac" },
  { id: "sand", label: "Sand", hint: "Navy on warm cream" },
] as const;

export const MODES = [
  { id: "auto", label: "Auto", hint: "Match this device" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

export type Theme = (typeof THEMES)[number]["id"];
export type Mode = (typeof MODES)[number]["id"];

export const THEME_COOKIE = "theme";
export const MODE_COOKIE = "mode";
/** One year, in seconds. */
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseTheme(value: string | undefined): Theme {
  return THEMES.find((theme) => theme.id === value)?.id ?? "evergreen";
}

export function parseMode(value: string | undefined): Mode {
  return MODES.find((mode) => mode.id === value)?.id ?? "auto";
}
