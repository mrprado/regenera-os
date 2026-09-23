import type { LucideIcon } from "lucide-react";
import styles from "./page.module.css";

/** Apollo-style page header: title + optional count on the left, actions on the right. */
export function PageHeader({ title, count, actions, children }: {
  title: string;
  count?: number;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.titleRow}>
        <h1 className={styles.title}>{title}{count !== undefined && <span className={styles.count}>{count.toLocaleString("en-US")}</span>}</h1>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export function EmptyState({ icon: Icon, title, body, phase, actions }: {
  icon: LucideIcon;
  title: string;
  body: string;
  phase?: number;
  actions?: React.ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}><Icon size={22} strokeWidth={1.6} aria-hidden /></span>
      <h2 className={styles.emptyTitle}>{title}</h2>
      <p className={styles.emptyBody}>{body}</p>
      {phase !== undefined && <p className={styles.phase}>Arrives in phase {phase}</p>}
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
