const ADMIN_EMAIL_ALLOWLIST = "ADMIN_EMAIL_ALLOWLIST";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function getAdminAllowlist(): string[] {
  const raw = process.env[ADMIN_EMAIL_ALLOWLIST] ?? "";
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map(normalizeEmail)
    .filter((email) => email.length > 0);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }

  const allowlist = getAdminAllowlist();
  if (allowlist.length === 0) {
    return false;
  }

  return allowlist.includes(normalizeEmail(email));
}
