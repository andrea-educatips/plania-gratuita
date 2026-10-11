// Registra lo que el docente hace con la planificación: si la valoró y si la copió.
// Va en la carpeta netlify/functions junto a planificar.js
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
    const { tipo, valor, plan_id, anon_id } = JSON.parse(event.body || "{}");
    if (!["valoracion", "copiado", "descarga_word"].includes(tipo)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Evento no válido" }) };
    }

    const url = process.env.REGISTRO_WEBHOOK_URL;
    if (url) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      try {
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipo,
            fecha: new Date().toISOString(),
            plan_id: String(plan_id || "").slice(0, 60),
            anon_id: String(anon_id || "").slice(0, 60),
            valor: String(valor || "").slice(0, 40),
          }),
          signal: ctrl.signal,
        });
      } catch (e) {
        console.log("Evento no guardado:", e.message);
      } finally {
        clearTimeout(t);
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Error interno." }) };
  }
};
