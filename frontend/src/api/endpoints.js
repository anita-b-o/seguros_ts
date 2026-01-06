export const USERS_ME = "/accounts/users/me";
export const ACCOUNTS_PROFILE = "/accounts/profile";
export const AUTH_GOOGLE_STATUS = "/auth/google/status";

export function ensureSingularNoTrailingSlash(path) {
  if (!path || typeof path !== "string") {
    throw new Error("Invalid singular endpoint: provide a non-empty path.");
  }
  const sanitized = path.replace(/\/+$/, "");
  if (!sanitized.startsWith("/")) {
    throw new Error("Singular endpoints must start with a slash.");
  }
  return sanitized;
}
