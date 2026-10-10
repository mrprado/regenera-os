/** Only ordinary same-origin workspace links enter the review drawer. */
export function reviewTarget(href: string, origin: string): string | null {
  const url = new URL(href, origin);
  if (url.origin !== origin || !url.pathname.startsWith('/') || /^\/(?:api|auth|signin|signout|oauth)(?:\/|$)/.test(url.pathname)) return null;
  if (url.pathname === '/today' || url.pathname === '/map' || url.hash && url.pathname === '/') return null;
  return url.pathname + url.search + url.hash;
}
