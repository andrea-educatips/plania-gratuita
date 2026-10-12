// Función programada (una vez al día): avisa por correo a quienes tienen un acceso de regalo por días
// que vence en los próximos 3 días, con el enlace para suscribirse.
import { getStore } from "@netlify/blobs";

const DIA = 24 * 60 * 60 * 1000;

export default async () => {
  const url = process.env.REGISTRO_WEBHOOK_URL;
  if (!url) return new Response("sin webhook");
  const store = getStore({ name: "plania-cuentas", consistency: "strong" });
  const { blobs } = await store.list({ prefix: "u/" });
  let enviados = 0;
  for (const b of blobs) {
    const u = await store.get(b.key, { type: "json" }).catch(() => null);
    const g = u && u.regalo;
    if (!g || g.tipo !== "dias" || g.avisado) continue;
    const falta = (g.hasta || 0) - Date.now();
    if (falta <= 0 || falta > 3 * DIA) continue;
    const fecha = new Date(g.hasta).toLocaleDateString("es-EC", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Guayaquil" });
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "aviso_regalo", email: u.email, nombre: u.nombre || "", detalle: `Tu acceso de regalo a PLANIA vence el ${fecha}.` }) });
      if ((await r.text()).trim() === "enviado") { g.avisado = true; await store.setJSON(b.key, u); enviados++; }
    } catch (e) { console.log("aviso:", e.message); }
  }
  return new Response("avisos enviados: " + enviados);
};

export const config = { schedule: "@daily" };
