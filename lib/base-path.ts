// The OS is served at the root of os.regenera.bio, so there is no base path. Plain <a href>, <form action> strings,
// fetch() and cookie paths still go through withBase() so a base path can return in one place (next.config.ts too).
export const BASE_PATH = "";
export const withBase = (path: string) => `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
