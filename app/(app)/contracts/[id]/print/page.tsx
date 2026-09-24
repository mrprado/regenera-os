import Link from "next/link";
import { notFound } from "next/navigation";
import MarkdownLite from "@/components/markdown-lite";
import { requireOsUser } from "@/lib/auth";
import { getContract } from "@/lib/contracts/queries";
import PrintButton from "../../print-button";
import styles from "../../contracts.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contract" };

// A clean page for the browser's Print or Save as PDF; the app shell is hidden in print.
export default async function ContractPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOsUser("/contracts");
  const { id } = await params;
  const data = await getContract(user.scope, id);
  if (!data) notFound();
  return (
    <>
      <div className={styles.printBar}>
        <PrintButton />
        <Link className="btn" href={`/contracts/${id}`}>Back to the contract</Link>
      </div>
      <MarkdownLite text={data.c.body} className={styles.doc} />
    </>
  );
}
