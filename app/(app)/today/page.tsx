import { requireOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Today" };

export default async function TodayPage() {
  await requireOsUser("/today");
  return (
    <section>
      <p className="eyebrow">Today</p>
      <h1>What needs you now.</h1>
      <p style={{ color: "var(--text-muted)", maxWidth: 620 }}>
        Queue, replies, meetings, overdue actions and new triggers arrive here from phase 1.
      </p>
    </section>
  );
}
