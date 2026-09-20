import { DurableObject } from "cloudflare:workers";

export class RateGate extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS hits (window INTEGER PRIMARY KEY, count INTEGER NOT NULL)");
  }

  allow(nowMs: number, limit = 20): boolean {
    const window = Math.floor(nowMs / 3_600_000);
    this.ctx.storage.sql.exec("DELETE FROM hits WHERE window < ?", window - 1);
    const row = this.ctx.storage.sql.exec<{ count: number }>(
      "INSERT INTO hits (window, count) VALUES (?, 1) ON CONFLICT(window) DO UPDATE SET count = count + 1 RETURNING count",
      window,
    ).one();
    return row.count <= limit;
  }
}
