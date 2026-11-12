import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMode, parseTheme, THEMES } from "@/lib/appearance";

describe("appearance", () => {
  it("falls back to Evergreen and Auto for missing or unknown cookies", () => {
    expect(parseTheme(undefined)).toBe("evergreen");
    expect(parseTheme("neon")).toBe("evergreen");
    expect(parseTheme("sand")).toBe("sand");
    expect(parseMode(undefined)).toBe("auto");
    expect(parseMode("sepia")).toBe("auto");
    expect(parseMode("dark")).toBe("dark");
  });

  it("has light and both dark versions (chosen and Auto) of every theme", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    for (const { id } of THEMES) {
      expect(css).toContain(`[data-theme="${id}"] {`);
      expect(css).toContain(`:root[data-mode="dark"] [data-theme="${id}"]`);
      expect(css).toContain(`:root:not([data-mode="light"]) [data-theme="${id}"]`);
    }
  });
});
