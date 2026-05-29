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
    const { subnivel, asignatura, grado, periodos, minutos, secuencia, metodologia, destreza, indicador, tema, competencias, inserciones } = JSON.parse(event.body);

    const compStr = competencias?.length ? competencias.join(", ") : "ninguna específica";
    const insStr  = inserciones?.length  ? inserciones.join(", ")  : "ninguna específica";
    const metStr  = metodologia || "sin metodología específica";

    const etapas = secuencia === "ACC"
      ? [["Anticipación","Activación de conocimientos previos"],["Construcción","Construcción del conocimiento"],["Consolidación","Transferencia y aplicación"]]
      : [["Experiencia","Recuperación"],["Reflexión","Comprensión"],["Conceptualización","Análisis"],["Aplicación","Utilización del conocimiento"]];

    const prompt = `Eres PLANIA, una IA especializada en planificación curricular ecuatoriana con dominio en la secuencia didáctica ${secuencia}, Diseño Universal para el Aprendizaje (DUA) y currículo MINEDUC.

Genera una planificación de clase completa con estos datos:
- Subnivel: ${subnivel}
- Asignatura: ${asignatura}
- Grado/Curso: ${grado}
- Períodos pedagógicos: ${periodos} (${minutos} minutos)
- Secuencia didáctica: ${secuencia}
- Metodología de la ${etapas[0][0]}: ${metStr}
- Destreza: ${destreza}
- Indicador de logro: ${indicador}
- Tema: ${tema}
- Énfasis en competencias: ${compStr}
- Inserciones curriculares: ${insStr}

REGLAS OBLIGATORIAS:
1. Todas las actividades inician con verbo en infinitivo
2. Cada etapa tiene sus tres principios DUA detallados (Representación, Acción y expresión, Implicación)
3. La ${etapas[0][0]} usa OBLIGATORIAMENTE la metodología: ${metStr}
4. Actividades colaborativas, kinestésicas, sin tecnología
5. Integra las inserciones curriculares de forma natural en cada etapa
6. Genera el objetivo automáticamente coherente con la destreza y el tema
7. Redacción humanizada, detallada y pedagógicamente sólida
8. Verbos en infinitivo al inicio de cada descripción de actividad

Responde ÚNICAMENTE con este JSON exacto (sin markdown, sin texto adicional):
{
  "tema": "${tema}",
  "objetivo": "objetivo generado coherente con la destreza",
  "ejes_transversales": "competencias e inserciones como ejes transversales",
  "etapas": {
    "${etapas[0][0].toLowerCase()}": {
      "nombre": "nombre descriptivo de la actividad",
      "actividad": "descripción detallada iniciando con verbo en infinitivo, mínimo 5 oraciones específicas",
      "representacion": "principio DUA Representación detallado, mínimo 2 oraciones",
      "accion": "principio DUA Acción y expresión detallado, mínimo 2 oraciones",
      "implicacion": "principio DUA Implicación detallado, mínimo 2 oraciones",
      "insercion": "cómo se integra la inserción curricular en esta etapa"
    },
    "${etapas[1][0].toLowerCase()}": {
      "nombre": "nombre descriptivo",
      "actividad": "descripción detallada iniciando con verbo en infinitivo, mínimo 5 oraciones",
      "representacion": "principio DUA detallado",
      "accion": "principio DUA detallado",
      "implicacion": "principio DUA detallado",
      "insercion": "integración de inserción curricular"
    },
    "${etapas[2][0].toLowerCase()}": {
      "nombre": "nombre descriptivo",
      "actividad": "descripción detallada iniciando con verbo en infinitivo, mínimo 5 oraciones",
      "representacion": "principio DUA detallado",
      "accion": "principio DUA detallado",
      "implicacion": "principio DUA detallado",
      "insercion": "integración de inserción curricular"
    }
    ${etapas.length === 4 ? `, "${etapas[3][0].toLowerCase()}": {
      "nombre": "nombre descriptivo",
      "actividad": "descripción detallada iniciando con verbo en infinitivo, mínimo 5 oraciones",
      "representacion": "principio DUA detallado",
      "accion": "principio DUA detallado",
      "implicacion": "principio DUA detallado",
      "insercion": "integración de inserción curricular"
    }` : ''}
  },
  "recursos": "lista de recursos concretos separados por coma",
  "tecnica": "técnica de evaluación apropiada para el subnivel",
  "instrumento": "instrumento de evaluación apropiado para el subnivel"
}`;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "API key no configurada en el servidor." }) };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 3500,
        temperature: 0.7,
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

    return { statusCode: 200, headers, body: JSON.stringify({ plan }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || "Error interno." }) };
  }
};
