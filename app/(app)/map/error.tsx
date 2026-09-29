"use client";

// ATLAS error boundary: a map failure (WebGL, a style, a provider) never takes down the rest of the OS.
import Link from "next/link";
import s from "@/components/skeleton.module.css";

export default function AtlasError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const webgl = /webgl|context/i.test(error.message);
  return (
    <div className={s.error} role="alert">
      <b>Atlas could not start.</b>
      <span>{webgl ? "The browser could not create a WebGL context (graphics acceleration may be off or the GPU is busy)." : "A map component failed to load."} Projects, capital and every other module keep working.</span>
      {error.digest ? <small>Reference {error.digest}</small> : null}
      <div style={{ display: "flex", gap: 8 }}><button className="btn btn--primary" type="button" onClick={() => reset()}>Reload Atlas</button><Link className="btn" href="/projects">Projects</Link></div>
    </div>
  );
}
