export const AUTH_COOKIE_NAME = "llm_auth";
export const AUTH_COOKIE_VALUE = "admin";
export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
export const AUTH_LOGIN_CODE = "admin";

export function isAuthCookieValid(value: string | undefined): boolean {
  return value === AUTH_COOKIE_VALUE;
}
