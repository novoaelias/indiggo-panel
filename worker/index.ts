import { Hono } from "hono";
import type { Env } from "./env";
import { api } from "./routes/api";
import { runCron } from "./cron";

const app = new Hono<{ Bindings: Env }>();

app.route("/api", api);

export default {
  fetch: app.fetch,

  async scheduled(
    event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runCron(event.cron, env));
  },
} satisfies ExportedHandler<Env>;
