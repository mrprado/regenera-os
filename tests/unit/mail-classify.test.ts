// Email intelligence classification (docs/plans/phase-13-mail-intelligence.md): low-signal mail is recognized with a
// stated basis; person-to-person mail stays substantive; sent mail to own addresses is internal.
import { describe, expect, it } from "vitest";
import { classify, newText, parseAddress, type RawMessage } from "@/lib/mail-intel/classify";

const OWN = ["alanprado@regenera.bio", "prado@regenera.bio"];
const m = (o: Partial<RawMessage>): RawMessage => ({ account: "alanprado@regenera.bio", gmailMessageId: "1", gmailThreadId: "1", internalDate: "2026-09-29T00:00:00Z", from: "someone@example.com", to: ["alanprado@regenera.bio"], cc: [], bcc: [], subject: "Hello", snippet: "", labels: ["INBOX"], ...o });

describe("mail classification", () => {
  it("keeps person-to-person mail substantive", () => {
    expect(classify(m({ from: "Christian Höller <christian.holler@generationforestinvest.com>", subject: "Generation Forest Panama" }), OWN).mailClass).toBe("substantive");
  });
  it("recognizes calendar, reminders and onboarding notices, each with a basis", () => {
    const cal = classify(m({ subject: "Invitation: Regenera Intro @ Wed Apr 16, 2025" }), OWN);
    expect(cal.mailClass).toBe("calendar");
    expect(classify(m({ subject: "[5 Min Reminder] Chat in a sec!" }), OWN).mailClass).toBe("calendar");
    const sw = classify(m({ subject: "Welcome to Miro!" }), OWN);
    expect(sw.mailClass).toBe("software_notification");
    expect(sw.basis.length).toBeGreaterThan(3);
  });
  it("treats Gmail promotions and unsubscribe footers as low signal", () => {
    expect(classify(m({ labels: ["CATEGORY_PROMOTIONS"], subject: "Join our webinar" }), OWN).mailClass).toBe("event_announcement");
    expect(classify(m({ body: "Great deals.\n\nUnsubscribe here" }), OWN).mailClass).toBe("newsletter");
  });
  it("sent mail to own addresses only is internal; sent mail to others is substantive", () => {
    expect(classify(m({ from: "prado@regenera.bio", to: ["alanprado@regenera.bio"] }), OWN).mailClass).toBe("internal_system");
    expect(classify(m({ from: "prado@regenera.bio", to: ["kent@charliefoxtrot.ai"] }), OWN).mailClass).toBe("substantive");
  });
  it("parses addresses and strips quoted history", () => {
    expect(parseAddress("Peter Henry <Peter@Matamba.dev>").email).toBe("peter@matamba.dev");
    expect(newText("Thanks!\n\nOn Mon, Apr 21, 2025 at 4:16 PM Taylor wrote:\n> old")).toBe("Thanks!");
  });
});
