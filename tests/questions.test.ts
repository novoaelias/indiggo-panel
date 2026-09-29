import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FIRMA_DEFECTO,
  esConsultaRiesgosa,
  firmar,
  guiaDeRedaccion,
  hayContradiccion,
  similitud,
} from "../worker/lib/questions";

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

describe("firma de la tienda", () => {
  it("cierra con la firma cuando la respuesta no la trae", () => {
    const texto = firmar("Sí, coordinamos la entrega sin problema.");
    expect(texto.endsWith(FIRMA_DEFECTO)).toBe(true);
    expect(texto.startsWith("Sí, coordinamos")).toBe(true);
  });

  it("no la duplica si ya está, aunque cambien tildes o puntuación", () => {
    const yaFirmada = "Sí, coordinamos.\nSaludos, equipo de Indiggo Store";
    expect(firmar(yaFirmada)).toBe(yaFirmada);
    expect(firmar(`Sí, coordinamos.\n${FIRMA_DEFECTO}`).match(/Indiggo/g)).toHaveLength(1);
  });

  it("reemplaza un saludo suelto del modelo por la firma completa", () => {
    const texto = firmar("Sí, coordinamos la entrega.\n¡Saludos!");
    expect(texto).toBe(`Sí, coordinamos la entrega.\n${FIRMA_DEFECTO}`);
  });

  it("nunca pasa el límite de 2000 caracteres de Mercado Libre", () => {
    const texto = firmar("a".repeat(2100));
    expect(texto.length).toBeLessThanOrEqual(2000);
    expect(texto.endsWith(FIRMA_DEFECTO)).toBe(true);
  });

  // El caso que originó esto: la IA contestaba "qué buena onda" y "¡dale!",
  // perdía el nombre de la compradora y recortaba los datos del vendedor.
  it("la guía prohíbe las muletillas y manda conservar los datos", () => {
    const guia = guiaDeRedaccion({ firma: FIRMA_DEFECTO, trato: "vos" });
    expect(guia).toContain('"dale"');
    expect(guia).toContain("buena onda");
    expect(guia).toContain("No resumas ni recortes datos");
    expect(guia).toContain(FIRMA_DEFECTO);
    expect(guiaDeRedaccion({ firma: FIRMA_DEFECTO, trato: "usted" })).toContain(
      "Tratá de usted",
    );
  });

  // "Redactar mejor" reescribe el apunte crudo con tono comercial y 💜, pero
  // los datos, la firma y la prohibición de muletillas siguen valiendo; la
  // automática sigue sin emojis.
  it("el modo comercial suma el corazón violeta sin soltar los datos", () => {
    const comercial = guiaDeRedaccion({ firma: FIRMA_DEFECTO, trato: "vos" }, "comercial");
    expect(comercial).toContain("💜");
    expect(comercial).toContain("No resumas ni recortes datos");
    expect(comercial).toContain('"dale"');
    expect(comercial).toContain(FIRMA_DEFECTO);
    expect(guiaDeRedaccion({ firma: FIRMA_DEFECTO, trato: "vos" })).not.toContain("💜");
  });

  // Una respuesta escrita a las apuradas en el cuadro final también se firma.
  it("el envío a Mercado Libre pasa por firmar()", () => {
    const ruta = readFileSync(
      new URL("../worker/routes/preguntas.ts", import.meta.url),
      "utf8",
    );
    expect(ruta).toContain("firmar(body.answer.trim(), estilo.firma)");
  });
});
