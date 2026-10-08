import { describe, expect, it } from "vitest";
import { inviteEmail } from "@/lib/portal/invite-mail";

describe("portal invitation email", () => {
  it("carries the single-use link, the portal type, the expiry and the sign-in address", () => {
    const m = inviteEmail({ name: "Taylor Allen", kind: "stakeholder", link: "https://os.regenera.bio/portal/invite/abc", invitedBy: "x@y", days: 14 });
    expect(m.subject).toBe("Your invitation to the Regenera stakeholder portal");
    for (const s of [m.text, m.html]) {
      expect(s).toContain("https://os.regenera.bio/portal/invite/abc");
      expect(s).toContain("14 days");
      expect(s).toContain("os.regenera.bio/portal/signin");
    }
  });
  it("escapes HTML in names", () => {
    expect(inviteEmail({ name: "<b>x</b>", kind: "sponsor", link: "https://a", invitedBy: "", days: 14 }).html).not.toContain("<b>x</b>");
  });
});
