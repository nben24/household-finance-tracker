const PUBLIC_PREFIXES = ["/login", "/auth"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Where to send a request, or null to let it through. */
export function authRedirectFor(pathname: string, isAuthenticated: boolean): string | null {
  if (!isAuthenticated && !isPublicPath(pathname)) return "/login";
  if (isAuthenticated && pathname === "/login") return "/";
  return null;
}

/** Only allow same-site relative paths as post-login destinations. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}
