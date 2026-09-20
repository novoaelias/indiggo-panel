import { useState } from "react";
import { Card, PrimaryButton } from "./ui";
import { enablePush } from "@/lib/push";

const soporta = () =>
  typeof window !== "undefined" &&
  "Notification" in window &&
  "serviceWorker" in navigator;

const instalada = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true);

/** Banner para activar los avisos en este dispositivo. Se muestra hasta que el
 *  permiso esté concedido, así no hay que ir a buscarlo a Configuración. En
 *  iPhone las notificaciones web sólo funcionan con el panel agregado a Inicio,
 *  así que si todavía está en Safari explica ese paso primero. */
export function AvisoPush() {
  const [estado, setEstado] = useState<"idle" | "activando" | "listo">(
    soporta() && Notification.permission === "granted" ? "listo" : "idle",
  );
  const [error, setError] = useState<string>();

  if (estado === "listo") return null;

  const enSafari = soporta() && !instalada();

  async function activar() {
    setEstado("activando");
    setError(undefined);
    try {
      const r = await enablePush();
      if (r === "enabled") setEstado("listo");
      else {
        setEstado("idle");
        setError("Faltan las claves de notificaciones en el servidor.");
      }
    } catch (e) {
      setEstado("idle");
      setError((e as Error).message);
    }
  }

  return (
    <Card className="mb-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold">
            Avisos de preguntas en este dispositivo
          </div>
          <p className="mt-1 text-[11.5px] text-ink/55">
            {enSafari
              ? "En el iPhone, primero tocá Compartir y elegí “Agregar a pantalla de inicio”. Abrí Indiggo desde ese ícono y volvé a tocar este botón."
              : "Te aviso cuando una pregunta necesite tu respuesta o cuando falle una respuesta automática."}
          </p>
          {error && <p className="mt-1 text-[11.5px] text-warn">{error}</p>}
        </div>
        <PrimaryButton disabled={estado === "activando"} onClick={activar}>
          {estado === "activando" ? "Activando…" : "Activar avisos"}
        </PrimaryButton>
      </div>
    </Card>
  );
}
