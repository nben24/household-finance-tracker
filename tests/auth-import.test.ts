import { describe, expect, it } from "vitest";
import { authRedirectFor, isPublicPath, safeNextPath } from "@/lib/auth/routes";
import { findSensitiveHeaders, stripSensitiveFields } from "@/lib/import/sensitive";

describe("route protection", () => {
  it("sends signed-out visitors to the login page for every app page", () => {
    for (const path of ["/", "/transactions", "/review", "/budget", "/settings", "/import", "/loginx", "/authentic"]) {
      expect(authRedirectFor(path, false), path).toBe("/login");
    }
  });

  it("lets signed-out visitors reach login and auth pages", () => {
    for (const path of ["/login", "/auth/confirm", "/auth/reset-password"]) {
      expect(isPublicPath(path)).toBe(true);
      expect(authRedirectFor(path, false), path).toBeNull();
    }
  });

  it("lets signed-in people through and skips the login page", () => {
    expect(authRedirectFor("/transactions", true)).toBeNull();
    expect(authRedirectFor("/auth/reset-password", true)).toBeNull();
    expect(authRedirectFor("/login", true)).toBe("/");
  });

  it("refuses to redirect to another site after login", () => {
    expect(safeNextPath("/transactions?month=2026-09")).toBe("/transactions?month=2026-09");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});

describe("sensitive CSV columns", () => {
  it("flags identifiers that must never be stored", () => {
    const headers = [
      "Transaction Date",
      "Description",
      "Amount",
      "Account Number",
      "Card No.",
      "Routing_Number",
      "SSN",
      "Tax ID",
      "Customer ID",
      "Login",
    ];
    expect(findSensitiveHeaders(headers)).toEqual([
      "Account Number",
      "Card No.",
      "Routing_Number",
      "SSN",
      "Tax ID",
      "Customer ID",
      "Login",
    ]);
  });

  it("leaves ordinary transaction columns alone", () => {
    const ordinary = ["Posting Date", "Description", "Amount", "Type", "Balance", "Category", "Account Name", "Card Member", "Reference"];
    expect(findSensitiveHeaders(ordinary)).toEqual([]);
  });

  it("removes sensitive values from a row", () => {
    const row = { Date: "09/27/2026", Description: "TRADER JOE S", Amount: "-82.41", "Account Number": "000123456789" };
    expect(stripSensitiveFields(row)).toEqual({ Date: "09/27/2026", Description: "TRADER JOE S", Amount: "-82.41" });
  });
});
