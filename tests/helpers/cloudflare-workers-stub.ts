// Stand-in for the "cloudflare:workers" module under vitest. Tests mutate `env` directly.
export const env: Record<string, unknown> = {};
