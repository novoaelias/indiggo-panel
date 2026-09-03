// Fechas en horario de Argentina. El Worker corre en UTC; calcular "hoy" con
// toISOString() daba el día equivocado de noche (UTC ya pasó a mañana). Argentina
// está fija en UTC−3 desde 2009 (sin horario de verano), así que alcanza con
// restar 3 h — no hace falta la maquinaria de Intl.
export const AR_TZ = "America/Argentina/Buenos_Aires";
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;

/** "YYYY-MM-DD" del día actual en Argentina. */
export function hoyAR(d: Date = new Date()): string {
  return new Date(d.getTime() - AR_OFFSET_MS).toISOString().slice(0, 10);
}

/** Instante UTC (ISO) en que arrancó el día de hoy en Argentina (00:00 AR). */
export function inicioDiaAR(d: Date = new Date()): string {
  return `${hoyAR(d)}T03:00:00.000Z`;
}

/** Inicio del día AR de hace `n` días (para ventanas tipo "últimos 7 días"). */
export function inicioDiaARHace(n: number, d: Date = new Date()): string {
  return inicioDiaAR(new Date(d.getTime() - n * 864e5));
}

/**
 * Hora de corte del reparto Flex: lo que se vende a partir de las 10:00 AR va a
 * la lista del día siguiente (el reparto de cada día se arma temprano).
 */
export const CORTE_REPARTO_HORA = 10;

/**
 * "YYYY-MM-DD" del día de reparto para un pedido: su día AR, o el siguiente si
 * se pagó a partir de las `corte` horas (10:00 por defecto).
 */
export function fechaRepartoAR(
  iso: string | Date,
  corte: number = CORTE_REPARTO_HORA,
): string {
  const ar = new Date(new Date(iso).getTime() - AR_OFFSET_MS);
  const d = ar.getUTCHours() >= corte ? new Date(ar.getTime() + 864e5) : ar;
  return d.toISOString().slice(0, 10);
}
