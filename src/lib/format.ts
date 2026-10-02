const AR_TZ = "America/Argentina/Buenos_Aires";

const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export function formatARS(n: number): string {
  return ars.format(n);
}

const fechaLarga = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: AR_TZ,
});

/** "lunes, 31 de agosto" — recalculado en cada llamada y en horario de Argentina. */
export function hoyLargo(): string {
  return fechaLarga.format(new Date());
}

export function saludo(d = new Date()): string {
  const h = Number(
    new Intl.DateTimeFormat("es-AR", {
      hour: "numeric",
      hour12: false,
      timeZone: AR_TZ,
    }).format(d),
  );
  if (h < 6) return "Buenas noches";
  if (h < 13) return "Buenos días";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
}

const diaYNumero = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  timeZone: AR_TZ,
});

/** "lunes 5" — el día de una fecha en horario de Argentina. */
export function diaCorto(iso: string): string {
  return diaYNumero.format(new Date(iso)).replace(",", "");
}
