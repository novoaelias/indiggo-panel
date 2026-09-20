import { buildPushPayload } from "@block65/webcrypto-web-push";
import type { Env } from "../env";

type LooseDb = {
  from: (name: string) => any;
};

export interface PushNotice {
  title: string;
  body: string;
  url: string;
  badge?: number;
}

export function pushConfigured(env: Env): boolean {
  return Boolean(
    env.VAPID_SUBJECT &&
      env.VAPID_SERVER_PUBLIC_KEY &&
      env.VAPID_SERVER_PRIVATE_KEY,
  );
}

export async function sendPush(
  env: Env,
  db: LooseDb,
  dedupeKey: string,
  notice: PushNotice,
): Promise<void> {
  if (!pushConfigured(env)) return;
  const { data: subscriptions } = await db
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("activo", true);
  for (const sub of subscriptions ?? []) {
    const { data: delivery } = await db
      .from("push_deliveries")
      .upsert(
        {
          subscription_id: sub.id,
          dedupe_key: dedupeKey,
          estado: "pendiente",
        },
        { onConflict: "subscription_id,dedupe_key", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();
    if (!delivery) continue;
    try {
      const payload = await buildPushPayload(
        { data: JSON.stringify(notice), options: { ttl: 60 * 60 * 12 } },
        {
          endpoint: sub.endpoint,
          expirationTime: null,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        {
          subject: env.VAPID_SUBJECT!,
          publicKey: env.VAPID_SERVER_PUBLIC_KEY!,
          privateKey: env.VAPID_SERVER_PRIVATE_KEY!,
        },
      );
      const response = await fetch(sub.endpoint, payload);
      if (!response.ok) {
        // 404/410: el navegador dio de baja esa suscripción. Se desactiva para
        // no seguir intentando (el iPhone vuelve a suscribirse desde el panel).
        if (response.status === 404 || response.status === 410)
          await db
            .from("push_subscriptions")
            .update({ activo: false, last_error: `push ${response.status}` })
            .eq("id", sub.id);
        throw new Error(`push ${response.status}`);
      }
      await db
        .from("push_deliveries")
        .update({ estado: "enviado", sent_at: new Date().toISOString() })
        .eq("id", delivery.id);
      await db
        .from("push_subscriptions")
        .update({ last_success_at: new Date().toISOString(), last_error: null })
        .eq("id", sub.id);
    } catch (error) {
      const message = (error as Error).message;
      await db
        .from("push_deliveries")
        .update({ estado: "error", error: message })
        .eq("id", delivery.id);
      await db
        .from("push_subscriptions")
        .update({ last_error: message })
        .eq("id", sub.id);
    }
  }
}

