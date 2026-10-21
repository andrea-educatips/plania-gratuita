// planificar-inicial.js — PLANIA Inicial (Educación Inicial Ecuador, MINEDUC 2014)

async function cuenta(accion, token, extra) {
  const base = process.env.URL || "https://plania.andreaeducatips.com";
  const r = await fetch(base + "/.netlify/functions/acceso", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ accion, token }, extra || {})),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, usuario: j.usuario || null };
}

const txt = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const lista = (v) =>
  Array.isArray(v) ? v.map((x) => txt(x, 80)).filter(Boolean).slice(0, 10) : [];

const SIGLA_INS = [
  [/socioemocional/i, "ES"],
  [/desarrollo sostenible/i, "EDS"],
  [/seguridad vial/i, "ESV"],
  [/c[ií]vica/i, "ECEI"],
  [/seguridad integral/i, "ESI"],
  [/financiera/i, "EF"],
];
const siglaIns = (n) => {
  const f = SIGLA_INS.find(([re]) => re.test(n || ""));
  return f ? f[1] : "";
};

const SIGLA_HAB = {
  comunicacional: "CC",
  digital: "CD",
  matemática: "CM",
  matematica: "CM",
  socioemocional: "CS",
};

async function procesar(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };

  try {
    const b = JSON.parse(event.body || "{}");
    const token = txt(b.token, 80);

    // Verificar sesión y cupo (reutiliza el mismo sistema que EGB)
    const aut = await cuenta("autorizar", token);
    if (aut.status === 401)
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Ingresa con tu correo para generar planificaciones.", codigo: "sesion" }) };
    if (aut.status === 428)
      return { statusCode: 428, headers, body: JSON.stringify({ error: "Completa tu perfil docente para generar planificaciones.", codigo: "perfil", usuario: aut.usuario }) };
    if (aut.status === 402)
      return { statusCode: 402, headers, body: JSON.stringify({ error: "Ya usaste tus planificaciones gratuitas.", codigo: "limite", usuario: aut.usuario }) };
    if (aut.status !== 200)
      return { statusCode: 503, headers, body: JSON.stringify({ error: "No pudimos verificar tu cuenta. Intenta de nuevo." }) };

    // ─── Extraer datos ───
    const subnivel = txt(b.subnivel_nombre, 80);
    const institucion = txt(b.institucion, 120);
    const docente = txt(b.docente, 120);
    const anio = txt(b.anio, 20);
    const semana = txt(b.semana, 80);
    const minutos = txt(b.minutos, 10);
    const tema = txt(b.tema, 200);
    const inserciones = lista(b.inserciones);
    const habilidades = lista(b.habilidades);
    const preferencias = txt(b.preferencias, 2000);

    const dias = (Array.isArray(b.dias) ? b.dias : []).slice(0, 5).map((d) => ({
      dia: txt(d.dia, 20),
      eje: txt(d.eje, 120),
      ambito: txt(d.ambito, 120),
      destreza: txt(d.destreza, 600),
      orientaciones: txt(d.orientaciones, 400),
      momentos: {
        act_iniciales: txt(d.momentos?.act_iniciales, 600),
        inicio: txt(d.momentos?.inicio, 600),
        desarrollo: txt(d.momentos?.desarrollo, 600),
        cierre: txt(d.momentos?.cierre, 600),
        act_finales: txt(d.momentos?.act_finales, 400),
      },
      dua: {
        inicio: { rep: txt(d.dua?.inicio?.rep, 400), acc: txt(d.dua?.inicio?.acc, 400), imp: txt(d.dua?.inicio?.imp, 400) },
        desarrollo: { rep: txt(d.dua?.desarrollo?.rep, 400), acc: txt(d.dua?.desarrollo?.acc, 400), imp: txt(d.dua?.desarrollo?.imp, 400) },
        cierre: { rep: txt(d.dua?.cierre?.rep, 400), acc: txt(d.dua?.cierre?.acc, 400), imp: txt(d.dua?.cierre?.imp, 400) },
      },
    }));

    const diasConDestreza = dias.filter((d) => d.destreza);
    if (diasConDestreza.length === 0)
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Selecciona al menos una destreza." }) };

    // ─── PROMPT ───
    const diasResumen = dias
      .map((d) => {
        if (!d.destreza) return `${d.dia}: Sin actividades planificadas.`;
        const momentosDocente = Object.entries(d.momentos)
          .filter(([, v]) => v)
          .map(([k, v]) => `  · ${k.replace(/_/g, " ")}: "${v}"`)
          .join("\n");
        const duaDocente = Object.entries(d.dua)
          .map(([m, dua]) => {
            const lineas = [dua.rep && `    Representación: ${dua.rep}`, dua.acc && `    Acción/Expresión: ${dua.acc}`, dua.imp && `    Implicación: ${dua.imp}`].filter(Boolean).join("\n");
            return lineas ? `  DUA ${m}:\n${lineas}` : "";
          })
          .filter(Boolean)
          .join("\n");
        return `${d.dia}:
  Eje: ${d.eje}
  Ámbito: ${d.ambito}
  Destreza: ${d.destreza}
  Orientaciones evaluación: ${d.orientaciones || "(no indicadas)"}
${momentosDocente ? `Notas del docente por momento:\n${momentosDocente}` : ""}
${duaDocente ? `DUA ingresado:\n${duaDocente}` : ""}`;
      })
      .join("\n\n");

    const prompt = `Eres un experto en planificación curricular para Educación Inicial de Ecuador, con dominio del Currículo de Educación Inicial 2014 del MINEDUC y del Diseño Universal para el Aprendizaje (DUA 3.0).

DATOS DE LA PLANIFICACIÓN:
- Subnivel: ${subnivel}
- Institución: ${institucion || "(no indicada)"}
- Docente: ${docente || "(no indicado)"}
- Año lectivo: ${anio}
- Semana del: ${semana || "(no indicada)"}
- Duración de clase: ${minutos || "45"} minutos
- Elemento integrador / Tema: ${tema || "(libre)"}
- Inserciones curriculares de la semana: ${inserciones.length > 0 ? inserciones.join(", ") : "ninguna seleccionada"}
- Habilidades para el siglo XXI: ${habilidades.length > 0 ? habilidades.join(", ") : "ninguna seleccionada"}
${preferencias ? `- Consideraciones especiales: ${preferencias}` : ""}

PLANIFICACIÓN POR DÍA:
${diasResumen}

INSTRUCCIONES:
Genera una planificación semanal completa en formato HTML (solo el contenido interno, sin <!doctype> ni <html> ni <head>).

La tabla debe tener esta estructura:
1. Encabezado con datos institucionales (institución, docente, subnivel, semana, año lectivo, elemento integrador)
2. Fila de inserciones curriculares con sus logos (usa <img> con estos src de data URI solo si están marcadas; marca con "X" o casilla marcada las que aplican)
3. Fila de habilidades siglo XXI con sus logos
4. Para cada día de la semana (Lunes a Viernes), si tiene destreza, una sección con:
   - Eje de desarrollo y Ámbito
   - Destreza a trabajar (texto completo)
   - Actividades iniciales (rutina de entrada: saludo, asistencia, fecha, tiempo meteorológico)
   - INICIO con DUA 3.0:
     * Representación: ¿Cómo se presenta la información/motivación?
     * Acción y Expresión: ¿Cómo participan?
     * Implicación: ¿Qué motiva a los niños?
   - DESARROLLO con DUA 3.0 (actividad central relacionada con la destreza):
     * Representación: materiales, formas de presentar el contenido
     * Acción y Expresión: lo que hacen los niños
     * Implicación: estrategias de motivación y participación
   - CIERRE con DUA 3.0 (evaluación formativa, reflexión):
     * Representación, Acción/Expresión, Implicación
   - Actividades finales (refrigerio, aseo, recreo)
   - Orientaciones para la evaluación
5. Observaciones generales del docente (espacio en blanco para llenar a mano)

IMPORTANTE PARA EL HTML:
- Usa colores morados (#951ABE, #6E1290, #E9E4F2) para el encabezado y cabeceras de la tabla
- Cada sección DUA debe tener fondo diferenciado: Representación=#fff3e0, Acción/Expresión=#e8f5e9, Implicación=#e3f2fd
- Las actividades que el docente ya ingresó deben aparecer COMPLETADAS; las que no ingresó, genera tú actividades apropiadas para el subnivel y la destreza
- Para niños de 3-5 años, las actividades deben ser concretas, lúdicas, sensoriales y adaptadas al desarrollo infantil
- Si el docente ya ingresó notas DUA, úsalas; si no, genera sugerencias apropiadas
- En las filas de inserciones y habilidades, muestra texto centrado con el nombre; si están seleccionadas, resalta la celda con fondo morado claro y negrita
- La tabla debe ser imprimible (buen espaciado, sin fondos muy oscuros en el contenido)
- Solo incluye días que tienen destreza seleccionada
- Responde ÚNICAMENTE con el HTML, sin explicaciones ni markdown

Recuerda: en Educación Inicial NO hay indicador de evaluación, solo orientaciones para la evaluación. El lenguaje debe ser apropiado para nivel inicial.`;

    // ─── OPENAI ───
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Configuración incompleta del servidor." }) };

    const aiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 4096,
        temperature: 0.7,
      }),
    });

    if (!aiResp.ok) {
      const err = await aiResp.json().catch(() => ({}));
      console.error("OpenAI error:", err);
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Error al generar con IA. Intenta de nuevo." }) };
    }

    const aiJson = await aiResp.json();
    let htmlResult = aiJson.choices?.[0]?.message?.content || "";
    // Limpiar posibles bloques markdown
    htmlResult = htmlResult.replace(/^```html?\n?/i, "").replace(/```$/m, "").trim();

    // ─── Descontar crédito ───
    await cuenta("consumir", token, { subnivel: "inicial" }).catch(() => {});

    return { statusCode: 200, headers, body: JSON.stringify({ html: htmlResult }) };
  } catch (e) {
    console.error("planificar-inicial error:", e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Error interno. Intenta de nuevo." }) };
  }
}

exports.handler = async (event) => {
  try {
    return await procesar(event);
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Error inesperado del servidor." }),
    };
  }
};
