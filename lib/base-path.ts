// The OS is served at regenera.bio/os (next.config.ts basePath). next/link, redirect() and router.push add it
// themselves; plain <a href>, <form action> strings, fetch() and absolute URLs built by hand use withBase().
export const BASE_PATH = "/os";
export const withBase = (path: string) => `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
