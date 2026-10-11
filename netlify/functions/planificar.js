const crypto = require("crypto");
const cuenta = require("./cuenta.js");

// Envía una fila al registro de investigación. Si falla, la planificación se entrega igual.
async function registrar(fila) {
  const url = process.env.REGISTRO_WEBHOOK_URL;
  if (!url) return;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fila),
      signal: ctrl.signal,
    });
  } catch (e) {
    console.log("Registro no guardado:", e.message);
  } finally {
    clearTimeout(t);
  }
}

const txt = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const lista = (v) => (Array.isArray(v) ? v.map((x) => txt(x, 60)).filter(Boolean).slice(0, 10) : []);

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido" }) };

  try {
    const b = JSON.parse(event.body || "{}");
    // Solo las cuentas registradas generan planificaciones. El cupo gratuito y la suscripción se revisan aquí.
    const store = cuenta.abrir(event);
    let usuario = await cuenta.usuarioDeToken(store, b.token);
    if (!usuario) return { statusCode: 401, headers, body: JSON.stringify({ error: "Ingresa con tu correo para generar planificaciones.", codigo: "sesion" }) };
    const acc = await cuenta.acceso(store, usuario);
    usuario = acc.u;
    if (!acc.ok) return { statusCode: 402, headers, body: JSON.stringify({ error: "Ya usaste tus planificaciones gratuitas.", codigo: "limite", usuario: cuenta.publico(usuario) }) };
    const subnivel = txt(b.subnivel, 80), asignatura = txt(b.asignatura, 80), grado = txt(b.grado, 60);
    const periodos = txt(b.periodos, 30), minutos = txt(b.minutos, 30);
    const secuencia = b.secuencia === "ACC" ? "ACC" : "ERCA";
    const destreza = txt(b.destreza, 1200), indicador = txt(b.indicador, 1500), tema = txt(b.tema, 200);
    // Contenidos de inserción definidos por el currículo para la destreza elegida en el mapa.
    const ejes = (Array.isArray(b.ejes) ? b.ejes : []).map((x) => ({ insercion: txt(x && x.insercion, 90), contenido: txt(x && x.contenido, 320) })).filter((x) => x.insercion && x.contenido).slice(0, 6);
    const deMapa = b.origen_destreza === "mapa";
    const competencias = lista(b.competencias), inserciones = lista(b.inserciones);
    const neeAjuste = txt(b.nee_ajuste, 800), neeAdaptacion = txt(b.nee_adaptacion, 800);
    const desagDocente = txt(b.destreza_desagregada, 1200);
    const METODOS = {
      "Aprendizaje Basado en Juegos (ABJ)": "la clase gira en torno a un juego con reglas, turnos y meta de aprendizaje; las etapas siguientes analizan y aplican lo ocurrido en el juego",
      "Gamificación": "toda la clase funciona con retos, puntos o insignias y niveles que se superan etapa por etapa, con un tablero visible de avance",
      "Aula invertida": "existe un trabajo previo en casa que se describe en el primer paso (lectura, observación o consulta sin depender de internet); la clase se dedica a discutir, resolver dudas y aplicar ese trabajo previo",
      "Aprendizaje Basado en Problemas": "la clase INICIA con un problema real y abierto del contexto del estudiante, redactado textualmente; las etapas siguientes lo analizan, investigan y resuelven, y el cierre presenta la solución",
      "Aprendizaje Basado en Proyectos": "la clase parte de una pregunta guía y avanza hacia un producto concreto; cada etapa construye una parte del producto y el cierre lo presenta",
      "Aprendizaje Basado en Retos": "la clase INICIA con un reto con condiciones y tiempo; las etapas siguientes planifican, prueban y mejoran la respuesta al reto",
      "Estaciones de aprendizaje": "el aula se organiza en estaciones con tareas distintas y rotación cronometrada; se describe cada estación y la consigna de rotación",
      "Casos de estudio": "la clase INICIA con un caso narrado textualmente; las etapas siguientes lo analizan con preguntas guía y llegan a conclusiones aplicables",
      "Trabajo colaborativo": "se trabaja en equipos con roles definidos y nombrados (por ejemplo coordinador, secretario, vocero, encargado del material), con interdependencia y un producto común",
      "Aprendizaje Basado en el Servicio": "la clase vincula el aprendizaje con una necesidad real de la escuela o la comunidad y termina con una acción de servicio concreta",
    };

    if (!subnivel || !asignatura || !grado || !destreza || !indicador) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Faltan datos obligatorios: subnivel, asignatura, grado, destreza e indicador." }) };
    }

    const compStr = competencias.length ? competencias.join(", ") : "ninguna específica";
    const insStr  = ejes.length ? ejes.map((x) => `${x.insercion}: ${x.contenido}`).join(" | ") : (inserciones.length ? inserciones.join(", ") : "ninguna específica");
    const insRegla = ejes.length
      ? `el currículo priorizado define para esta destreza estos contenidos de inserción curricular: ${ejes.map((x) => `${x.insercion} = "${x.contenido}"`).join("; ")}. Trabaja EXACTAMENTE esos contenidos dentro de las etapas, de forma natural y visible en lo que hacen los estudiantes. No los cambies ni agregues otros. En "ejes_transversales" cópialos tal cual`
      : (deMapa
        ? `el currículo no marca inserciones curriculares en esta destreza. No incluyas ninguna: deja "ejes_transversales" como lista vacía y el campo "insercion" de cada etapa como cadena vacía`
        : `por cada inserción elegida escoge UN contenido específico y concreto (por ejemplo, en educación socioemocional: comunicación asertiva; en educación financiera: ahorro; en seguridad vial: señales de tránsito). Trabaja ese mismo contenido dentro de las etapas, de forma natural, y decláralo en "ejes_transversales"`);
    const metStr  = txt(b.metodologia, 80) || "sin metodología específica";
    const metRegla = METODOS[metStr]
      ? `La metodología ${metStr} se aplica en TODA la clase y debe reconocerse en las actividades sin necesidad de nombrarla: ${METODOS[metStr]}`
      : "No se eligió una metodología específica: usa estrategias activas variadas";

    const etapas = secuencia === "ACC"
      ? [["Anticipación","Activación de conocimientos previos"],["Construcción","Construcción del conocimiento"],["Consolidación","Transferencia y aplicación"]]
      : [["Experiencia","Recuperación"],["Reflexión","Comprensión"],["Conceptualización","Análisis"],["Aplicación","Utilización del conocimiento"]];

    const etapaJson = (e) => `"${e[0].toLowerCase()}": {
      "nombre": "nombre descriptivo de la actividad",
      "nivel_marzano": "${e[1]}",
      "tiempo": "minutos asignados a esta etapa",
      "pasos": ["paso 1 iniciando con verbo en infinitivo, con la consigna exacta que da el docente", "paso 2", "paso 3", "paso 4"],
      "representacion": "pauta del principio DUA Representación y breve descripción de cómo se aplica, mínimo 2 oraciones",
      "accion": "pauta del principio DUA Acción y expresión y breve descripción, mínimo 2 oraciones",
      "implicacion": "pauta del principio DUA Compromiso o implicación y breve descripción, mínimo 2 oraciones",
      "insercion": "cómo se integra la inserción curricular en esta etapa, o cadena vacía si no hay inserciones"
    }`;

    const neeDatos = (neeAjuste || neeAdaptacion) ? `
NECESIDADES EDUCATIVAS ESPECÍFICAS descritas por el docente (sin nombres de estudiantes):
${neeAjuste ? `- Ajuste razonable. Motivo: ${neeAjuste}` : ""}
${neeAdaptacion ? `- Adaptación curricular. Motivo o diagnóstico: ${neeAdaptacion}` : ""}` : "";

    const neeReglas = `${neeAjuste ? `
13. AJUSTE RAZONABLE: no modifica la destreza ni el indicador. Propón de 2 a 3 ajustes, cada uno sobre una actividad concreta de esta misma planificación.` : ""}${neeAdaptacion ? `
14. ADAPTACIÓN CURRICULAR: desagrega y gradúa la destreza del subnivel reduciendo su complejidad. Si no alcanza, usa una destreza de un subnivel inferior relacionada con la clase. Redacta un indicador de logro adaptado y actividades propias para ese estudiante.` : ""}`;

    const neeJson = `${neeAjuste ? `,
  "ajustes_razonables": [
    { "motivo": "motivo resumido", "actividad": "actividad de la planificación que se modifica", "ajuste": "ajuste concreto para el estudiante" }
  ]` : ""}${neeAdaptacion ? `,
  "adaptacion_curricular": {
    "motivo": "motivo resumido",
    "destreza_adaptada": "destreza con criterio de desempeño adaptada",
    "indicador_adaptado": "indicador de logro adaptado",
    "orientaciones": "actividades adaptadas iniciando con verbo en infinitivo, mínimo 4 oraciones",
    "recursos": "recursos concretos separados por coma",
    "evaluacion": "técnica e instrumento de evaluación adaptados"
  }` : ""}`;

    const prompt = `Eres PLANIA, una IA especializada en planificación curricular ecuatoriana con dominio en la secuencia didáctica ${secuencia}, Diseño Universal para el Aprendizaje (DUA) y currículo MINEDUC.

Genera una planificación de clase completa con estos datos:
- Subnivel: ${subnivel}
- Asignatura: ${asignatura}
- Grado/Curso: ${grado}
- Períodos pedagógicos: ${periodos} (${minutos})
- Secuencia didáctica: ${secuencia}
- Metodología activa de la clase: ${metStr}
- Destreza con criterio de desempeño oficial: ${destreza}${desagDocente ? `
- Destreza desagregada escrita por el docente (úsala tal cual como alcance de la clase): ${desagDocente}` : ""}
- Indicador de logro: ${indicador}
- Tema: ${tema}
- Énfasis en competencias: ${compStr}
- Inserciones curriculares: ${insStr}
${neeDatos}

REGLAS OBLIGATORIAS:
1. Todas las actividades inician con verbo en infinitivo
2. Cada etapa tiene sus tres principios DUA detallados (Representación, Acción y expresión, Implicación)
3. METODOLOGÍA: ${metRegla}
4. Actividades colaborativas y kinestésicas, pensadas para un aula sin tecnología
5. INSERCIONES: ${insRegla}
5b. COMPETENCIAS: las competencias elegidas (${compStr}) van implícitas. NO las nombres ni escribas frases que digan dónde se aplican. Deben cumplirse de verdad en lo que hacen los estudiantes: la comunicacional con producción oral o escrita y escucha entre pares; la matemática con contar, medir, comparar, estimar o razonar con datos; la digital con manejo de información, secuencias de pasos o pensamiento computacional desconectado; la socioemocional con reconocimiento de emociones, empatía, acuerdos y trabajo con otros
5c. DESAGREGACIÓN: ${desagDocente ? 'el docente ya escribió la destreza desagregada; cópiala sin cambios en "destreza_desagregada" y planifica para ese alcance' : 'desagrega la destreza oficial para lo que realmente se puede lograr en esta clase con este tema y este tiempo, manteniendo su estructura (habilidad + contenido + nivel de complejidad) y sin inventar códigos. Si la destreza ya es acotada, repítela'}. Todas las actividades y la rúbrica responden a la destreza desagregada
6. Genera el objetivo automáticamente coherente con la destreza y el tema
7. Redacción humanizada, detallada y pedagógicamente sólida
8. Distribuye el tiempo entre las etapas de modo que la suma sea exactamente ${minutos}
9. DETALLE DE ACTIVIDADES: cada etapa se escribe en "pasos", de 4 a 6 pasos en orden. Cada paso inicia con verbo en infinitivo y dice con claridad qué hace el docente, qué hacen los estudiantes, cómo se organizan y con qué material. Incluye las preguntas o consignas textuales que el docente plantea y el producto que se espera. Prohibido escribir pasos genéricos como "Explicar el tema" o "Realizar una actividad".
10. TAXONOMÍA DE MARZANO: los verbos y la demanda cognitiva de cada etapa corresponden al nivel indicado en "nivel_marzano" (Recuperación: reconocer, recordar, ejecutar. Comprensión: integrar, simbolizar. Análisis: comparar, clasificar, analizar errores, generalizar, especificar. Utilización del conocimiento: tomar decisiones, resolver problemas, experimentar, investigar). Avanza de menor a mayor complejidad.
11. RECURSOS: detalla cada recurso con cantidad y cómo se prepara o se usa. Son materiales del aula o de bajo costo. Si un recurso se beneficia de material de apoyo en internet (video, lectura, plantilla), escribe en "busqueda" las palabras exactas para encontrarlo. NO escribas direcciones web ni enlaces.
12. RÚBRICA: mínimo 3 y máximo 4 criterios, nunca menos de 3, derivados del indicador de logro y de las actividades de esta planificación, con descriptores observables y distintos en cada nivel de la escala ecuatoriana${neeReglas}

Responde ÚNICAMENTE con este JSON exacto (sin markdown, sin texto adicional):
{
  "tema": "tema de la clase",
  "objetivo": "objetivo generado coherente con la destreza",
  "destreza_desagregada": "destreza desagregada para el alcance de esta clase",
  "ejes_transversales": [
    { "insercion": "nombre de la inserción elegida", "contenido": "contenido específico que se transversaliza" }
  ],
  "etapas": {
    ${etapas.map(etapaJson).join(",\n    ")}
  },
  "recursos": [
    { "nombre": "recurso con su cantidad", "detalle": "cómo se prepara o se usa en la clase", "busqueda": "palabras para buscar material de apoyo, o cadena vacía" }
  ],
  "rubrica": [
    { "criterio": "criterio 1", "dar": "...", "aar": "...", "paar": "...", "naar": "..." },
    { "criterio": "criterio 2", "dar": "...", "aar": "...", "paar": "...", "naar": "..." },
    { "criterio": "criterio de evaluación", "dar": "descriptor de Domina los aprendizajes requeridos", "aar": "descriptor de Alcanza los aprendizajes requeridos", "paar": "descriptor de Está próximo a alcanzar los aprendizajes requeridos", "naar": "descriptor de No alcanza los aprendizajes requeridos" }
  ],
  "tecnica": "técnica de evaluación apropiada para el subnivel",
  "instrumento": "instrumento de evaluación apropiado para el subnivel"${neeJson}
}`;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "API key no configurada en el servidor." }) };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 6000,
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Eres PLANIA, experta en currículo ecuatoriano, secuencias ERCA y ACC, y DUA. Respondes ÚNICAMENTE con JSON válido sin markdown." },
          { role: "user", content: prompt }
        ]
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Error OpenAI: ${response.status}`);
    }

    const data = await response.json();
    const raw = data.choices[0].message.content.trim();
    let plan;
    try { plan = JSON.parse(raw.replace(/```json|```/g, "").trim()); }
    catch { throw new Error("PLANIA no devolvió un JSON válido. Intenta de nuevo."); }

    if (ejes.length) plan.ejes_transversales = ejes;
    else if (!inserciones.length || deMapa) plan.ejes_transversales = [];
    plan.origen_destreza = deMapa ? "mapa" : "manual";
    if (deMapa) { plan.codigo_destreza = txt(b.codigo, 20); plan.criterio = txt(b.criterio, 20); }
    if (desagDocente) plan.destreza_desagregada = desagDocente;
    plan.desagregacion_origen = desagDocente ? "docente" : "plania";
    const plan_id = crypto.randomUUID();
    await registrar({
      tipo: "planificacion",
      fecha: new Date().toISOString(),
      plan_id,
      anon_id: txt(b.anon_id, 60),
      subnivel, asignatura, grado, periodos, minutos, secuencia,
      trimestre: txt(b.trimestre, 20),
      institucion: txt(b.institucion, 150),
      area: txt(b.area, 80),
      periodo_lectivo: txt(b.periodo_lectivo, 30),
      unidad: txt(b.unidad, 20),
      titulo_unidad: txt(b.titulo_unidad, 150),
      metodologia: metStr,
      competencias: compStr,
      inserciones: insStr,
      destreza, indicador, tema,
      nee_ajuste: neeAjuste,
      nee_adaptacion: neeAdaptacion,
      tecnica: txt(plan.tecnica, 200),
      instrumento: txt(plan.instrumento, 200),
      valor: "",
      plan_json: JSON.stringify(plan),
    });

    usuario.usos = (usuario.usos || 0) + 1;
    usuario.ultimo_uso = new Date().toISOString();
    await store.setJSON("u/" + usuario.email, usuario);
    return { statusCode: 200, headers, body: JSON.stringify({ plan, plan_id, usuario: cuenta.publico(usuario) }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || "Error interno." }) };
  }
};
