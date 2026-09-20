import { api } from "./api";

function applicationKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function mismaClave(subscription: PushSubscription, key: Uint8Array): boolean {
  const actual = subscription.options?.applicationServerKey;
  if (!actual) return false;
  const bytes = new Uint8Array(actual);
  return (
    bytes.length === key.length && bytes.every((byte, i) => byte === key[i])
  );
}

export async function enablePush(): Promise<"enabled" | "not-configured"> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window))
    throw new Error("Este dispositivo no admite notificaciones web.");
  const config = await api<{ configured: boolean; publicKey: string | null }>(
    "/preguntas/push/config",
  );
  if (!config.configured || !config.publicKey) return "not-configured";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("No se concedió permiso para notificaciones.");
  const registration = await navigator.serviceWorker.ready;
  const key = applicationKey(config.publicKey);
  let existing = await registration.pushManager.getSubscription();
  // Una suscripción hecha con otra clave VAPID queda muda: el servidor no puede
  // firmarle los avisos. Si no coincide, se da de baja y se vuelve a suscribir.
  if (existing && !mismaClave(existing, key)) {
    await existing.unsubscribe();
    existing = null;
  }
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    }));
  await api("/preguntas/push/subscribe", {
    method: "POST",
    body: JSON.stringify(subscription.toJSON()),
  });
  return "enabled";
}
