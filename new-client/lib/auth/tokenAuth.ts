export const TOKEN_AUTH_EMAIL_DOMAIN =
  process.env.NEXT_PUBLIC_TOKEN_AUTH_EMAIL_DOMAIN ?? "tokenauth.quarry.app";

export function buildTokenAuthEmail(token: string) {
  return `token-${token}@${TOKEN_AUTH_EMAIL_DOMAIN}`;
}
