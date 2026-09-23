export const metadata = { title: "Today" };

export default function TodayPage() {
  return (
    <section>
      <p className="eyebrow">Today</p>
      <h1>What needs you now.</h1>
      <p style={{ color: "var(--text-muted)", maxWidth: 620 }}>
        Phase 0 shell. Queue, replies, meetings, overdue actions and new triggers arrive here from phase 1.
      </p>
    </section>
  );
}
