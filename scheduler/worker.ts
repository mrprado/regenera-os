// Regenera OS scheduler (SPEC section 23). Holds no data: every 5 minutes it asks the OS to run due jobs.
interface Env {
  TICK_URL: string;          // https://os.regenera.bio/api/jobs/tick
  JOBS_TICK_TOKEN: string;   // same value as the OS secret
}

const scheduler: ExportedHandler<Env> = {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      const res = await fetch(env.TICK_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${env.JOBS_TICK_TOKEN}` },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`Tick returned ${res.status}: ${await res.text()}`);
    })());
  },
};

export default scheduler;
