// Portal invitation email (system notification via Resend, like the daily digest). Sent only when a person creates or
// re-sends an invitation and leaves "Email the invitation" ticked. The link is single-use and expires in 14 days.
import { PORTAL_KINDS, type PortalKind } from "./vocab";

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Pure: subject, HTML and text for one invitation. */
export function inviteEmail(x: { name: string; kind: PortalKind; link: string; invitedBy: string; days: number }) {
  const who = x.name.trim() || "there";
  const portal = PORTAL_KINDS[x.kind];
  const subject = `Your invitation to the Regenera ${portal.toLowerCase()} portal`;
  const text = [
    `Hello ${who},`, "",
    `You have been invited to the Regenera ${portal.toLowerCase()} portal.`,
    "Open the link below to set your password. It works once and expires in " + x.days + " days.", "",
    x.link, "",
    "After that, sign in at https://os.regenera.bio/portal/signin with this email address.", "",
    "If you were not expecting this invitation, you can ignore this email.", "",
    "Regenera · regenera.bio",
  ].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#252D27;max-width:560px;line-height:1.5">
<p style="font-size:13px;letter-spacing:.14em;color:#7B887E;margin:0 0 18px">REGENERA</p>
<p>Hello ${esc(who)},</p>
<p>You have been invited to the Regenera <b>${esc(portal.toLowerCase())}</b> portal.</p>
<p style="margin:24px 0"><a href="${esc(x.link)}" style="background:#252D27;color:#FBFAF7;text-decoration:none;padding:12px 18px;border-radius:6px;display:inline-block">Set your password</a></p>
<p style="font-size:13px;color:#686357">The link works once and expires in ${x.days} days. After that, sign in at <a href="https://os.regenera.bio/portal/signin" style="color:#246448">os.regenera.bio/portal/signin</a> with this email address.</p>
<p style="font-size:13px;color:#686357">If the button does not work, copy this address into your browser:<br>${esc(x.link)}</p>
<p style="font-size:12px;color:#7B887E;margin-top:28px">If you were not expecting this invitation, you can ignore this email.<br>Regenera · regenera.bio</p></div>`;
  return { subject, html, text };
}
