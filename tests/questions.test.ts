import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { esConsultaRiesgosa, hayContradiccion, similitud } from "../worker/lib/questions";

const fuente = readFileSync(
  new URL("../worker/lib/questions.ts", import.meta.url),
  "utf8",
);

describe("decisión de preguntas", () => {
  it("detecta compromisos que requieren revisión", () => {
    expect(esConsultaRiesgosa("¿Me llega mañana a mi domicilio?")).toBe(true);
    expect(esConsultaRiesgosa("¿Tenés stock para personalizarlo?")).toBe(true);
  });

  it("reconoce preguntas repetidas aun con otra redacción", () => {
    expect(
      similitud(
        "¿El pack trae las letras de los siete nombres?",
        "¿Incluye letras para formar los siete nombres?",
      ),
    ).toBeGreaterThan(0.35);
  });

  it("deriva a revisión cuando las fuentes pertinentes se contradicen", () => {
    expect(
      hayContradiccion([
        { respuesta: "Sí, incluye las siete opciones.", score: 0.8 },
        { respuesta: "No, el pack trae una sola opción.", score: 0.7 },
      ]),
    ).toBe(true);
  });

  // Mercado Libre puede haber sido respondido desde la app: antes de enviar se
  // vuelve a leer la pregunta y sólo se contesta si sigue sin responder.
  it("no responde dos veces la misma pregunta", () => {
    expect(fuente).toContain('if (question.status !== "UNANSWERED")');
    const envio = fuente.indexOf('mlFetch(env, db as never, "/answers"');
    const chequeo = fuente.indexOf('if (question.status !== "UNANSWERED")');
    expect(chequeo).toBeGreaterThan(0);
    expect(envio).toBeGreaterThan(chequeo);
  });

  it("deja de reintentar un trabajo que falla siempre", () => {
    expect(fuente).toContain("MAX_INTENTOS");
    expect(fuente).toContain('.lt("intentos", MAX_INTENTOS)');
  });
});
