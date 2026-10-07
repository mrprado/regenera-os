// Google Drive: save OS-generated files into a "Regenera OS" folder in the connected Workspace account. Uses the drive.file
// scope already requested at sign-in, which only sees files and folders this app created, so the OS never reads the rest
// of the Drive. Nothing is shared by this module: files keep the owner's default Drive permissions.
import { z } from "zod";

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink";
export const DRIVE_FOLDER = "Regenera OS";

const zFile = z.object({ id: z.string(), name: z.string().optional(), webViewLink: z.string().optional() });
const zList = z.object({ files: z.array(zFile).default([]) });

async function call<T>(res: Response, schema: z.ZodType<T>, what: string): Promise<T> {
  if (!res.ok) throw new Error(`Google Drive ${what} failed (HTTP ${res.status}). ${res.status === 401 || res.status === 403 ? "Reconnect Google in Settings → Connections." : ""}`.trim());
  return schema.parse(await res.json());
}

/** The app's folder, created once. With drive.file only folders this app made are visible, so a search cannot collide. */
export async function ensureFolder(accessToken: string, name = DRIVE_FOLDER, fetchImpl: typeof fetch = fetch): Promise<string> {
  const q = encodeURIComponent(`name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const found = await call(await fetchImpl(`${API}?q=${q}&fields=files(id,name)&pageSize=1`, { headers: { authorization: `Bearer ${accessToken}` } }), zList, "folder lookup");
  const existing = found.files?.[0];
  if (existing) return existing.id;
  const made = await call(await fetchImpl(`${API}?fields=id`, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }) }), zFile, "folder creation");
  return made.id;
}

/** Multipart upload: JSON metadata + file bytes in one request. */
export function multipartBody(meta: Record<string, unknown>, bytes: Uint8Array, mimeType: string, boundary: string): Uint8Array {
  const enc = new TextEncoder();
  const head = enc.encode(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`);
  const tail = enc.encode(`\r\n--${boundary}--`);
  const out = new Uint8Array(head.length + bytes.length + tail.length);
  out.set(head, 0); out.set(bytes, head.length); out.set(tail, head.length + bytes.length);
  return out;
}

export async function uploadToDrive(accessToken: string, file: { name: string; mimeType: string; bytes: Uint8Array; description?: string }, fetchImpl: typeof fetch = fetch) {
  const folderId = await ensureFolder(accessToken, DRIVE_FOLDER, fetchImpl);
  const boundary = `regenera-${crypto.randomUUID()}`;
  const body = multipartBody({ name: file.name, parents: [folderId], description: file.description ?? "Saved from Regenera OS" }, file.bytes, file.mimeType, boundary);
  const res = await fetchImpl(UPLOAD, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": `multipart/related; boundary=${boundary}` }, body: body as BodyInit });
  return call(res, zFile, "upload");
}
