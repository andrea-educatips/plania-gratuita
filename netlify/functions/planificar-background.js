// Versión en segundo plano de la generación (Netlify Background Function, hasta 15 minutos).
// El navegador recibe un 202 inmediato y consulta el resultado con la acción "trabajo_ver" de la función acceso.
const { procesar } = require("./planificar");

async function guardar(token, trabajo_id, status, body) {
  const base = process.env.URL || "https://plania.andreaeducatips.com";
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(base + "/.netlify/functions/acceso", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "trabajo_guardar", token, trabajo_id, status, body }) });
      if (r.ok) return;
    } catch (e) { console.log("guardar trabajo:", e.message); }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

exports.handler = async (event) => {
  let b = {};
  try { b = JSON.parse(event.body || "{}"); } catch (e) {}
  const token = String(b.token || "").slice(0, 80), id = String(b.trabajo_id || "").slice(0, 60);
  if (!/^[a-zA-Z0-9-]{8,60}$/.test(id)) return { statusCode: 200 };
  let r;
  try { r = await procesar(Object.assign({}, event, { httpMethod: "POST" })); }
  catch (e) { r = { statusCode: 500, body: JSON.stringify({ error: e.message || "Error interno." }) }; }
  await guardar(token, id, r.statusCode, r.body);
  // Siempre se responde sin error para que Netlify no reintente y no se cobre dos veces.
  return { statusCode: 200 };
};
