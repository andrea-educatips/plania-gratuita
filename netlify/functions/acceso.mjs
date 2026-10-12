// Función v2 de Netlify (permite lectura consistente del almacén).
// Cuentas de PLANIA: registro con código al correo, sesión, cupo gratuito y suscripción con PayPal.
import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

const LIMITE = parseInt(process.env.PLANIA_LIMITE_GRATIS || "5", 10);
const PRECIO = process.env.PLANIA_PRECIO || "10";
const DIA = 24 * 60 * 60 * 1000;
const CONSENT_V = 2;   // versión del texto de autorización (2: comunicaciones e investigación anónima)
const PERFIL_V = 1;    // versión del formulario de perfil docente
const uid = (email) => crypto.createHash("sha256").update(String(email)).digest("hex").slice(0, 16);
const OPC = {
  tipo_institucion: ["Fiscal", "Fiscomisional", "Municipal", "Particular"],
  niveles: ["Inicial", "Preparatoria", "Básica Elemental", "Básica Media", "Básica Superior", "Bachillerato General Unificado", "Bachillerato Técnico"],
  titulo: ["Bachiller", "Técnico o tecnólogo", "Licenciatura o profesorado en Ciencias de la Educación", "Título de tercer nivel en otra área", "Maestría", "Doctorado"],
  estudia: ["No, ya culminé mis estudios", "Sí, estoy cursando mi carrera de tercer nivel", "Sí, estoy cursando un posgrado"],
  dispositivos: ["Sí, la mayoría de estudiantes tiene acceso a dispositivos e internet en la institución", "Solo algunos estudiantes o en espacios limitados", "No, los estudiantes no tienen acceso a dispositivos en la institución"],
};
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const out = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers });
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

const perfilCompleto = (u) => !!(u.perfil && (u.perfil_v || 0) >= PERFIL_V && (u.consent_v || 0) >= CONSENT_V);

function publico(u) {
  const activa = (u.paid_until || 0) > Date.now();
  return {
    email: u.email, nombre: u.nombre || "", uid: uid(u.email), usos: u.usos || 0, limite: LIMITE, precio: PRECIO,
    perfil_completo: perfilCompleto(u), perfil: u.perfil || null, consent_ok: (u.consent_v || 0) >= CONSENT_V,
    preferencias: u.preferencias || "",
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

export default async (req) => {
  if (req.method === "OPTIONS") return out(200, {});
  if (req.method !== "POST") return out(405, { error: "Método no permitido" });
  try {
    const b = await req.json().catch(() => ({}));
    const store = getStore({ name: "plania-cuentas", consistency: "strong" });
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
      await store.setJSON("c/" + email, { codigo, exp: ahora + 15 * 60 * 1000, intentos: 0, envios: envios.concat(ahora), nombre: nombre || previo.nombre || "", acepta: b.acepta === true || !!previo.acepta });
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
        u = { email, nombre: c.nombre || "", creado: new Date().toISOString(), usos: 0, paid_until: 0, sub_id: "", consent_v: c.acepta ? CONSENT_V : 0 };
        await store.setJSON("u/" + email, u);
        await hoja({ tipo: "usuario", fecha: u.creado, email, nombre: u.nombre, acepta: c.acepta ? "sí (v" + CONSENT_V + ")" : "no" }, 8000);
      }
      await store.setJSON("c/" + email, { envios: c.envios || [] });
      const token = crypto.randomBytes(24).toString("hex");
      await store.setJSON("s/" + token, { email, exp: Date.now() + 60 * DIA });
      return out(200, { token, usuario: publico(u) });
    }

    const u = await usuarioDeToken(store, b.token);
    if (!u) return out(401, { error: "Tu sesión terminó. Ingresa de nuevo." });

    // Usadas por la función planificar: revisar el cupo antes de generar y descontarlo después.
    if (accion === "autorizar") {
      if (!perfilCompleto(u)) return out(428, { error: "Completa tu perfil docente para generar planificaciones.", usuario: publico(u) });
      const a = await acceso(store, u);
      return out(a.ok ? 200 : 402, { ok: a.ok, usuario: publico(a.u) });
    }
    if (accion === "consumir") {
      u.usos = (u.usos || 0) + 1; u.ultimo_uso = new Date().toISOString();
      if (typeof b.preferencias === "string") u.preferencias = txt(b.preferencias, 3000);
      await store.setJSON("u/" + u.email, u);
      // Historial: cada planificación queda guardada en la cuenta del docente.
      if (b.registro && b.registro.plan_id) {
        const id = txt(b.registro.plan_id, 60);
        const clave = "h/" + u.email + "/" + new Date().toISOString().replace(/[:.]/g, "-") + "_" + id;
        await store.setJSON(clave, { plan_id: id, fecha: new Date().toISOString(), datos: b.registro.datos || {}, plan: b.registro.plan || {} });
        await store.setJSON("pi/" + id, { email: u.email, clave });
      }
      return out(200, { usuario: publico(u) });
    }

    if (accion === "perfil") {
      const p = b.perfil || {};
      const sel = (k) => (OPC[k].includes(p[k]) ? p[k] : "");
      const perfil = {
        nacionalidad: txt(p.nacionalidad, 60),
        provincia: txt(p.provincia, 60),
        tipo_institucion: sel("tipo_institucion"),
        niveles: (Array.isArray(p.niveles) ? p.niveles : []).filter((x) => OPC.niveles.includes(x)),
        grados: txt(p.grados, 120),
        areas: txt(p.areas, 160),
        experiencia: Math.max(0, Math.min(60, parseInt(p.experiencia, 10) || 0)),
        titulo: sel("titulo"),
        estudia: sel("estudia"),
        dispositivos: sel("dispositivos"),
      };
      const falta = ["nacionalidad", "provincia", "tipo_institucion", "grados", "areas", "titulo", "estudia", "dispositivos"].filter((k) => !perfil[k]);
      if (!perfil.niveles.length) falta.push("niveles");
      if (String(p.experiencia ?? "").trim() === "") falta.push("experiencia");
      if (falta.length) return out(400, { error: "Completa todos los campos del perfil.", falta });
      if (b.acepta === true) u.consent_v = CONSENT_V;
      if ((u.consent_v || 0) < CONSENT_V) return out(400, { error: "Marca la casilla de autorización para continuar." });
      const nombre = txt(b.nombre, 80);
      if (nombre) u.nombre = nombre;
      u.perfil = perfil; u.perfil_v = PERFIL_V; u.perfil_fecha = new Date().toISOString();
      await store.setJSON("u/" + u.email, u);
      await hoja(Object.assign({ tipo: "perfil", fecha: u.perfil_fecha, usuario_id: uid(u.email), email: u.email, nombre: u.nombre, acepta: "sí (v" + CONSENT_V + ")" }, perfil, { niveles: perfil.niveles.join(", ") }), 8000);
      return out(200, { usuario: publico(u) });
    }

    if (accion === "valorar") {
      const id = txt(b.plan_id, 60);
      const SIRVIO = ["La usaría tal cual", "Me sirve con ajustes", "No me sirve"];
      const MODIF = ["Nada", "Poco", "Bastante", "Tendría que rehacerla"];
      const sirvio = SIRVIO.includes(b.sirvio) ? b.sirvio : "", modificacion = MODIF.includes(b.modificacion) ? b.modificacion : "";
      if (!id || (!sirvio && !modificacion)) return out(400, { error: "Respuesta no válida." });
      const ref = await store.get("pi/" + id, { type: "json" });
      if (ref && ref.email === u.email) {
        const h = await store.get(ref.clave, { type: "json" });
        if (h) { h.valoracion = Object.assign(h.valoracion || {}, sirvio ? { sirvio } : {}, modificacion ? { modificacion } : {}); await store.setJSON(ref.clave, h); }
      }
      await hoja({ tipo: "valoracion", fecha: new Date().toISOString(), plan_id: id, usuario_id: uid(u.email), sirvio, modificacion }, 8000);
      return out(200, { ok: true });
    }

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
