// Shared helpers for the sign-in route handlers (app/api/auth/*).
import { withBase } from "./base-path";

/** Form posts must come from this origin (login CSRF). Browsers always send Origin on POST. */
export function sameOrigin(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}

export function redirectTo(request: Request, path: string, cookie?: string) {
  const headers = new Headers({ location: new URL(withBase(path), request.url).toString() });
  if (cookie) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export function sessionCookie(request: Request, name: string, value: string, maxAgeSeconds: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=${withBase("/").replace(/\/$/, "")}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export const isLocalRequest = (request: Request) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
