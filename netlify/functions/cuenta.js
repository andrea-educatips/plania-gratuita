// Cuentas de PLANIA: registro con código al correo, sesión, cupo gratuito y suscripción con PayPal.
const crypto = require("crypto");
const { getStore, connectLambda } = require("@netlify/blobs");

const LIMITE = parseInt(process.env.PLANIA_LIMITE_GRATIS || "5", 10);
const PRECIO = process.env.PLANIA_PRECIO || "10";
const DIA = 24 * 60 * 60 * 1000;
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const out = (code, obj) => ({ statusCode: code, headers, body: JSON.stringify(obj) });
const txt = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const correoOk = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(e);
const paypalListo = () => !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET && process.env.PAYPAL_PLAN_ID);
const paypalBase = () => (process.env.PAYPAL_ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com");

async function hoja(fila, ms, espera) {
  const url = process.env.REGISTRO_WEBHOOK_URL;
  if (!url) return false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 3000);
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fila), signal: ctrl.signal });
    const s = await r.text();
    return r.ok && s.trim() === (espera || "ok");
  } catch (e) {
    console.log("Hoja:", e.message);
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function paypalSuscripcion(id) {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString("base64");
  const tk = await fetch(`${paypalBase()}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  if (!tk.ok) throw new Error("No se pudo consultar PayPal.");
  const { access_token } = await tk.json();
  const r = await fetch(`${paypalBase()}/v1/billing/subscriptions/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${access_token}` } });
  if (!r.ok) throw new Error("PayPal no reconoce esa suscripción.");
  return r.json();
}

// Devuelve hasta cuándo queda habilitada la cuenta según el estado real de la suscripción en PayPal.
function vigencia(sub) {
  if (!sub || sub.plan_id !== process.env.PAYPAL_PLAN_ID) return 0;
  const prox = sub.billing_info && sub.billing_info.next_billing_time ? Date.parse(sub.billing_info.next_billing_time) : 0;
  if (sub.status === "ACTIVE") return (prox || Date.now() + 31 * DIA) + DIA;
  return 0;
}

function publico(u) {
  const activa = (u.paid_until || 0) > Date.now();
  return {
    email: u.email, nombre: u.nombre || "", usos: u.usos || 0, limite: LIMITE, precio: PRECIO,
    suscripcion_activa: activa, vence: activa ? u.paid_until : 0,
    cobro_activo: paypalListo(),
    paypal: paypalListo() ? { client_id: process.env.PAYPAL_CLIENT_ID, plan_id: process.env.PAYPAL_PLAN_ID } : null,
  };
}

async function usuarioDeToken(store, token) {
  token = txt(token, 80);
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const s = await store.get("s/" + token, { type: "json" });
  if (!s || s.exp < Date.now()) return null;
  return store.get("u/" + s.email, { type: "json" });
}

// Revisa si la cuenta puede generar. Si tiene suscripción vencida en nuestros datos, la confirma con PayPal.
async function acceso(store, u) {
  if ((u.paid_until || 0) > Date.now()) return { ok: true, u };
  if (u.sub_id && paypalListo()) {
    try {
      const v = vigencia(await paypalSuscripcion(u.sub_id));
      u.paid_until = v;
      if (!v) u.sub_id = "";
      await store.setJSON("u/" + u.email, u);
      if (v > Date.now()) return { ok: true, u };
    } catch (e) { console.log("PayPal:", e.message); }
  }
  if (!paypalListo()) return { ok: true, u };            // mientras el cobro no esté activo no se bloquea a nadie
  return { ok: (u.usos || 0) < LIMITE, u };
}

exports.abrir = (event) => { connectLambda(event); return getStore({ name: "plania-cuentas", consistency: "strong" }); };
exports.usuarioDeToken = usuarioDeToken;
exports.acceso = acceso;
exports.publico = publico;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return out(200, {});
  if (event.httpMethod !== "POST") return out(405, { error: "Método no permitido" });
  try {
    const b = JSON.parse(event.body || "{}");
    const store = exports.abrir(event);
    const accion = txt(b.accion, 20);

    if (accion === "solicitar") {
      const email = txt(b.email, 255).toLowerCase(), nombre = txt(b.nombre, 80);
      if (!correoOk(email)) return out(400, { error: "Escribe un correo electrónico válido." });
      const existe = await store.get("u/" + email, { type: "json" });
      if (!existe && (!nombre || b.acepta !== true)) return out(400, { error: "Para crear tu cuenta escribe tu nombre y acepta el uso de tus datos." });
      const ahora = Date.now();
      const previo = (await store.get("c/" + email, { type: "json" })) || {};
      const envios = (previo.envios || []).filter((t) => t > ahora - 60 * 60 * 1000);
      if (envios.length >= 4) return out(429, { error: "Ya enviamos varios códigos a ese correo. Revisa tu bandeja y tu carpeta de spam, o intenta en una hora." });
      const hoy = new Date().toISOString().slice(0, 10);
      const dia = (await store.get("dia/" + hoy, { type: "json" })) || { n: 0 };
      if (dia.n >= 90) return out(429, { error: "Hoy se alcanzó el máximo de registros. Intenta de nuevo mañana." });
      const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      await store.setJSON("c/" + email, { codigo, exp: ahora + 15 * 60 * 1000, intentos: 0, envios: envios.concat(ahora), nombre: nombre || previo.nombre || "" });
      const ok = await hoja({ tipo: "enviar_codigo", email, codigo, nombre: nombre || (existe && existe.nombre) || "" }, 9000, "enviado");
      if (!ok) return out(502, { error: "No pudimos enviar el código en este momento. Intenta de nuevo en unos minutos." });
      await store.setJSON("dia/" + hoy, { n: dia.n + 1 });
      return out(200, { ok: true, nueva: !existe });
    }

    if (accion === "verificar") {
      const email = txt(b.email, 255).toLowerCase(), codigo = txt(b.codigo, 6);
      const c = await store.get("c/" + email, { type: "json" });
      if (!c || !c.codigo || c.exp < Date.now()) return out(400, { error: "El código venció. Pide uno nuevo." });
      if (c.intentos >= 5) return out(429, { error: "Demasiados intentos. Pide un código nuevo." });
      const igual = codigo.length === 6 && crypto.timingSafeEqual(Buffer.from(codigo), Buffer.from(c.codigo));
      if (!igual) { c.intentos += 1; await store.setJSON("c/" + email, c); return out(400, { error: "El código no coincide. Revísalo e intenta de nuevo." }); }
      let u = await store.get("u/" + email, { type: "json" });
      if (!u) {
        u = { email, nombre: c.nombre || "", creado: new Date().toISOString(), usos: 0, paid_until: 0, sub_id: "" };
        await store.setJSON("u/" + email, u);
        await hoja({ tipo: "usuario", fecha: u.creado, email, nombre: u.nombre, acepta: "sí" }, 4000);
      }
      await store.setJSON("c/" + email, { envios: c.envios || [] });
      const token = crypto.randomBytes(24).toString("hex");
      await store.setJSON("s/" + token, { email, exp: Date.now() + 60 * DIA });
      return out(200, { token, usuario: publico(u) });
    }

    const u = await usuarioDeToken(store, b.token);
    if (!u) return out(401, { error: "Tu sesión terminó. Ingresa de nuevo." });

    if (accion === "estado") {
      const a = await acceso(store, u);
      return out(200, { usuario: publico(a.u) });
    }

    if (accion === "suscribir") {
      if (!paypalListo()) return out(400, { error: "El cobro aún no está activo." });
      const id = txt(b.subscription_id, 40);
      if (!/^I-[A-Z0-9]{6,30}$/.test(id)) return out(400, { error: "Suscripción no válida." });
      const dueno = await store.get("p/" + id, { type: "json" });
      if (dueno && dueno.email !== u.email) return out(400, { error: "Esa suscripción ya pertenece a otra cuenta." });
      const v = vigencia(await paypalSuscripcion(id));
      if (!v) return out(400, { error: "PayPal todavía no confirma el pago. Espera un minuto y vuelve a intentar." });
      u.sub_id = id; u.paid_until = v;
      await store.setJSON("u/" + u.email, u);
      await store.setJSON("p/" + id, { email: u.email });
      await hoja({ tipo: "suscripcion", fecha: new Date().toISOString(), email: u.email, nombre: u.nombre, suscripcion: id, vence: new Date(v).toISOString() }, 4000);
      return out(200, { usuario: publico(u) });
    }

    if (accion === "salir") {
      await store.delete("s/" + txt(b.token, 80));
      return out(200, { ok: true });
    }
    return out(400, { error: "Acción no reconocida." });
  } catch (err) {
    console.log("cuenta:", err.message);
    return out(500, { error: err.message || "Error interno." });
  }
};
