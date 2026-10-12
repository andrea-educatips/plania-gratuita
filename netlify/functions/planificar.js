const crypto = require("crypto");

// Consulta la función de cuentas: revisa el cupo antes de generar y lo descuenta después.
async function cuenta(accion, token, extra) {
  const base = process.env.URL || "https://plania.andreaeducatips.com";
  const r = await fetch(base + "/.netlify/functions/acceso", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ accion, token }, extra || {})) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, usuario: j.usuario || null };
}

// Envía una fila al registro de investigación. Si falla, la planificación se entrega igual.
async function registrar(fila) {
  const url = process.env.REGISTRO_WEBHOOK_URL;
  if (!url) return;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
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
const limpiaEjes = (v) => (Array.isArray(v) ? v : []).map((x) => ({ insercion: txt(x && x.insercion, 90), contenido: txt(x && x.contenido, 320) })).filter((x) => x.insercion && x.contenido).slice(0, 6);

// Siglas con las que se marca en cada actividad la competencia que se desarrolla.
const SIGLA = { "comunicacional": "CC", "matemática": "CM", "digital": "CD", "socioemocional": "CS" };
// Siglas de las inserciones curriculares, a partir del nombre largo (mapa) o corto (selección manual).
const SIGLA_INS = [
  [/socioemocional/i, "ES"], [/desarrollo sostenible/i, "EDS"], [/seguridad vial/i, "ESV"],
  [/c[ií]vica/i, "ECEI"], [/seguridad integral/i, "ESI"], [/financiera/i, "EF"],
];
const siglaIns = (nombre) => { const f = SIGLA_INS.find(([re]) => re.test(nombre || "")); return f ? f[1] : ""; };
const INICIOS = { "situacion": "una situación de aprendizaje", "juego": "un juego", "lectura": "una lectura", "experimento": "un experimento" };
// Lo que exige cada competencia según el Currículo priorizado con énfasis en competencias (MINEDUC), apartado 3.
const EXIGE = {
  "comunicacional": "los estudiantes escuchan o leen un texto y lo comprenden, o producen un texto oral o escrito y su destinatario es capaz de comprenderlo; hay escucha activa y enunciación ordenada y coherente de ideas",
  "matemática": "los estudiantes usan y relacionan números, operaciones, símbolos o formas de razonamiento matemático para resolver un problema, tomar una decisión o pensar críticamente, y argumentan y comunican su razonamiento",
  "digital": "los estudiantes interactúan con un dispositivo o una aplicación digital para acceder a información, gestionarla, comunicarse o crear, de forma responsable, segura y ética",
  "socioemocional": "los estudiantes reconocen y comprenden sus propias emociones, pensamientos y conductas, comprenden las de los demás y se relacionan de forma positiva: colaboran, llegan a acuerdos o toman decisiones responsables",
};

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
    // Solo las cuentas registradas y con perfil completo generan planificaciones.
    const token = txt(b.token, 80);
    const aut = await cuenta("autorizar", token);
    if (aut.status === 401) return { statusCode: 401, headers, body: JSON.stringify({ error: "Ingresa con tu correo para generar planificaciones.", codigo: "sesion" }) };
    if (aut.status === 428) return { statusCode: 428, headers, body: JSON.stringify({ error: "Completa tu perfil docente para generar planificaciones.", codigo: "perfil", usuario: aut.usuario }) };
    if (aut.status === 402) return { statusCode: 402, headers, body: JSON.stringify({ error: "Ya usaste tus planificaciones gratuitas.", codigo: "limite", usuario: aut.usuario }) };
    if (aut.status !== 200) return { statusCode: 503, headers, body: JSON.stringify({ error: "No pudimos verificar tu cuenta. Intenta de nuevo en un momento." }) };

    const subnivel = txt(b.subnivel, 80), asignatura = txt(b.asignatura, 80), grado = txt(b.grado, 60);
    const periodos = txt(b.periodos, 30), minutos = txt(b.minutos, 30);
    const secuencia = b.secuencia === "ACC" ? "ACC" : "ERCA";
    const destreza = txt(b.destreza, 1200), indicador = txt(b.indicador, 1500), tema = txt(b.tema, 200);
    const ejes = limpiaEjes(b.ejes);
    const deMapa = b.origen_destreza === "mapa";
    const competencias = lista(b.competencias).filter((c) => SIGLA[c]), inserciones = lista(b.inserciones);
    const neeAjuste = txt(b.nee_ajuste, 800), neeAdaptacion = txt(b.nee_adaptacion, 800);
    const desagDocente = txt(b.destreza_desagregada, 1200);
    const preferencias = txt(b.preferencias, 3000);
    const digitales = b.digitales === "si" ? "si" : (b.digitales === "no" ? "no" : "");
    const invertida = txt(b.metodologia, 80) === "Aula invertida";
    const inicio = invertida ? "invertida" : (INICIOS[b.inicio] ? b.inicio : "plania");
    // Hasta dos destrezas secundarias, de cualquier área, que se transversalizan.
    const secundarias = (Array.isArray(b.secundarias) ? b.secundarias : []).slice(0, 2).map((x) => ({
      codigo: txt(x && x.codigo, 20), asignatura: txt(x && x.asignatura, 80), destreza: txt(x && x.destreza, 900),
      competencias: lista(x && x.competencias).filter((c) => SIGLA[c]), ejes: limpiaEjes(x && x.ejes),
    })).filter((x) => x.destreza && x.destreza !== destreza);

    const METODOS = {
      "Aprendizaje Basado en Juegos (ABJ)": "la clase gira en torno a un juego con reglas, turnos y meta de aprendizaje; las etapas siguientes analizan y aplican lo ocurrido en el juego",
      "Gamificación": "toda la clase funciona con retos, puntos o insignias y niveles que se superan etapa por etapa, con un tablero visible de avance",
      "Aula invertida": "existe un trabajo previo en casa que se describe en el primer paso (lectura, observación o consulta); la clase se dedica a discutir, resolver dudas y aplicar ese trabajo previo",
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
    if (!digitales) return { statusCode: 400, headers, body: JSON.stringify({ error: "Indica si quieres actividades con herramientas digitales." }) };

    // Competencias de toda la planificación: las de la destreza principal y las de las secundarias.
    const compTodas = [...new Set([...competencias, ...secundarias.flatMap((x) => x.competencias)])];
    const compStr = compTodas.length ? compTodas.map((c) => `${c} (${SIGLA[c]})`).join(", ") : "ninguna específica";
    const insStr = ejes.length ? ejes.map((x) => `${x.insercion}: ${x.contenido}`).join(" | ") : (inserciones.length ? inserciones.join(", ") : "ninguna específica");
    const insRegla = ejes.length
      ? `el currículo priorizado define para la destreza principal estos contenidos de inserción curricular: ${ejes.map((x) => `${x.insercion} = "${x.contenido}"`).join("; ")}. Trabaja EXACTAMENTE esos contenidos, sin cambiarlos ni agregar otros. En "ejes_transversales" cópialos tal cual`
      : (deMapa
        ? `el currículo no marca inserciones curriculares en la destreza principal. Deja "ejes_transversales" como lista vacía`
        : `por cada inserción elegida escoge UN contenido específico y concreto (por ejemplo, en educación socioemocional: comunicación asertiva; en educación financiera: ahorro; en seguridad vial: señales de tránsito) y decláralo en "ejes_transversales"`);
    const metStr = txt(b.metodologia, 80) || "sin metodología específica";
    const metRegla = METODOS[metStr]
      ? `La metodología ${metStr} se aplica en TODA la clase y debe reconocerse en las actividades sin necesidad de nombrarla: ${METODOS[metStr]}`
      : "No se eligió una metodología específica: usa estrategias activas variadas";

    const etapas = secuencia === "ACC"
      ? [["Anticipación","Activación de conocimientos previos"],["Construcción","Construcción del conocimiento"],["Consolidación","Transferencia y aplicación"]]
      : [["Experiencia","Recuperación"],["Reflexión","Comprensión"],["Conceptualización","Análisis"],["Aplicación","Utilización del conocimiento"]];
    const etInicio = etapas[0][0], etExplica = secuencia === "ACC" ? "Construcción" : "Conceptualización";
    const etPreguntas = secuencia === "ACC" ? "Anticipación" : "Reflexión";
    // Siglas válidas de inserciones para esta planificación (principal y secundarias).
    const insNombres = [...ejes.map((x) => x.insercion), ...(ejes.length || deMapa ? [] : inserciones), ...secundarias.flatMap((x) => x.ejes.map((e) => e.insercion))];
    const insSiglas = [...new Set(insNombres.map(siglaIns).filter(Boolean))];
    const inicioRegla = inicio === "invertida"
      ? `la metodología es aula invertida: el inicio es el trabajo previo que el estudiante hizo en casa. Describe ese trabajo previo en "inicio_texto" (qué leyó, observó o consultó, con el contenido concreto) y deja "inicio_tipo" como "Trabajo previo (aula invertida)". El primer paso de ${etInicio} recupera ese trabajo previo`
      : `la clase inicia con ${inicio === "plania" ? "la actividad que mejor se ajuste a la destreza (situación de aprendizaje, juego, lectura, experimento, caso u otra); elígela tú" : INICIOS[inicio] + ", porque así lo eligió el docente"}. El inicio busca un aprendizaje significativo: conecta lo que el estudiante ya sabe con el nuevo conocimiento. No uses una lluvia de ideas como inicio. Redacta el inicio completo en "inicio_texto" (la situación narrada en 4 a 7 líneas, las reglas y la dinámica del juego, el texto de la lectura o el procedimiento del experimento con sus materiales) y su tipo en "inicio_tipo". El primer paso de ${etInicio} lo presenta`;
    const transImplicita = secundarias.length
      ? ""
      : ` Cuando el inicio sea una situación de aprendizaje, integra en ella de forma natural un contenido de otra asignatura del mismo subnivel que se relacione con la destreza (por ejemplo de Estudios Sociales, Ciencias Naturales o Matemática), y también sus inserciones o competencias, sin declararlo como otra destreza. En un juego hazlo solo si encaja con naturalidad. En un experimento no es obligatorio.`;

    const etapaJson = (e) => `"${e[0].toLowerCase()}": {
      "nombre": "nombre descriptivo de la actividad",
      "nivel_marzano": "${e[1]}",
      "tiempo": "minutos asignados a esta etapa",
      "pasos": ["paso 1 detallado", "paso 2", "paso 3", "paso 4", "paso 5"],
      "material": "texto COMPLETO que el docente lee, escribe en la pizarra o entrega en esta etapa, mínimo 70 palabras",
      "representacion": "pauta del principio DUA Representación y cómo se aplica en esta etapa, mínimo 2 oraciones",
      "accion": "pauta del principio DUA Acción y expresión y cómo se aplica, mínimo 2 oraciones",
      "implicacion": "pauta del principio DUA Compromiso o implicación y cómo se aplica, mínimo 2 oraciones"
    }`;

    const secDatos = secundarias.length ? `
- Destrezas que se transversalizan (secundarias):
${secundarias.map((x, i) => `  ${i + 1}. ${x.codigo ? x.codigo + " " : ""}(${x.asignatura || "otra área"}): ${x.destreza}${x.ejes.length ? ` | Inserciones: ${x.ejes.map((e) => `${e.insercion} = "${e.contenido}"`).join("; ")}` : ""}${x.competencias.length ? ` | Competencias: ${x.competencias.join(", ")}` : ""}`).join("\n")}` : "";

    const neeDatos = (neeAjuste || neeAdaptacion) ? `
NECESIDADES EDUCATIVAS ESPECÍFICAS descritas por el docente (sin nombres de estudiantes):
${neeAjuste ? `- Ajuste razonable. Motivo: ${neeAjuste}` : ""}
${neeAdaptacion ? `- Adaptación curricular. Motivo o diagnóstico: ${neeAdaptacion}` : ""}` : "";

    const digRegla = digitales === "si"
      ? `el docente SÍ quiere herramientas digitales. Incluye al menos dos pasos en los que los estudiantes usen una herramienta digital gratuita y conocida (por ejemplo una pizarra colaborativa, un formulario o cuestionario en línea, un editor de presentaciones o de video, un simulador). Di qué herramienta, qué hace el docente con ella y qué producen los estudiantes. No escribas direcciones web`
      : `el docente NO quiere herramientas digitales en el aula: las actividades de clase usan materiales físicos y de bajo costo, sin dispositivos`;
    const casaRegla = (digitales === "no" && compTodas.includes("digital"))
      ? `la destreza trae competencia digital y el docente no usará dispositivos en clase. En "tarea_casa" propone una tarea breve para casa en la que el estudiante interactúe con una herramienta digital gratuita y conocida, vinculada al tema; la consigna termina con (CD). Si en casa no hay dispositivo, ofrece una alternativa con el celular de un familiar`
      : `deja "tarea_casa" con consigna y herramienta como cadenas vacías`;

    const neeReglas = `${neeAjuste ? `
16. AJUSTE RAZONABLE: no modifica la destreza ni el indicador. Propón de 2 a 3 ajustes, cada uno sobre una actividad concreta de esta misma planificación.` : ""}${neeAdaptacion ? `
17. ADAPTACIÓN CURRICULAR: desagrega y gradúa la destreza del subnivel reduciendo su complejidad. Si no alcanza, usa una destreza de un subnivel inferior relacionada con la clase. Redacta un indicador de logro adaptado y actividades propias para ese estudiante.` : ""}`;

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

    const prompt = `Eres PLANIA, una IA especializada en planificación curricular ecuatoriana con dominio en la secuencia didáctica ${secuencia}, Diseño Universal para el Aprendizaje (DUA) y el Currículo priorizado con énfasis en competencias del MINEDUC.

Genera una planificación de clase completa con estos datos:
- Subnivel: ${subnivel}
- Asignatura: ${asignatura}
- Grado/Curso: ${grado}
- Períodos pedagógicos: ${periodos} (${minutos})
- Secuencia didáctica: ${secuencia}
- Metodología activa de la clase: ${metStr}
- Destreza con criterio de desempeño principal: ${destreza}${desagDocente ? `
- Destreza desagregada escrita por el docente (úsala tal cual como alcance de la clase): ${desagDocente}` : ""}
- Indicador de evaluación elegido por el docente: ${indicador}
- Tema: ${tema}
- Competencias: ${compStr}
- Inserciones curriculares de la destreza principal: ${insStr}${secDatos}
- Herramientas digitales: ${digitales === "si" ? "sí" : "no"}${preferencias ? `
- Indicaciones del docente (contenido de su libro o preferencias para su clase): """${preferencias}"""` : ""}
${neeDatos}

REGLAS OBLIGATORIAS:
1. Todos los pasos inician con verbo en infinitivo.
2. ACTIVIDADES REALES Y DETALLADAS: cada etapa tiene de 4 a 7 pasos en orden. Cada paso dice qué hace el docente y CÓMO lo hace, qué hacen los estudiantes, cómo se organizan, con qué material y qué producto se obtiene. Todo lo que el docente necesita decir o entregar va escrito completo dentro del paso: las preguntas, las consignas, el enunciado del problema, las reglas del juego, el texto breve original que se lee, los ejemplos y los datos. Prohibido escribir directrices vagas como "Explicar el tema", "Realizar una lluvia de ideas", "Plantear preguntas" o "Hacer una actividad" sin desarrollarlas.
3. PREGUNTAS DE ${etPreguntas.toUpperCase()}: escribe en "preguntas_reflexion" las preguntas que el docente formula en ${etPreguntas}, nacidas directamente de lo que se vivió en el inicio (la situación, el juego, la lectura o el experimento): una pregunta literal, una o dos inferenciales y una crítico-valorativa, en ese orden y sin rotularlas. ${secuencia === "ACC" ? "En ACC, la Anticipación reúne la experiencia inicial y la reflexión sobre ella." : "La Reflexión siempre analiza lo que se presentó en la Experiencia."} En las demás etapas no hace falta un bloque de preguntas.
3b. MATERIAL: cada etapa trae en "material" el contenido completo que el docente necesita, ya redactado y listo para usar: el texto, discurso, cuento o noticia que se lee (original, de 100 a 200 palabras cuando se pide leer o escuchar), el enunciado del problema con sus datos, las reglas del juego o del debate, el ejemplo modelado paso a paso, o el organizador gráfico con todo su contenido. Si un paso dice "leer", "presentar", "explicar" o "dar reglas", lo que se lee, presenta, explica o regula está escrito en "material". Nunca escribas "un discurso ficticio", "un texto breve" o "ejemplos" sin redactarlos.
4. INICIO DE LA CLASE (${etInicio}): ${inicioRegla}. Debe estar situado en el contexto cercano del estudiante ecuatoriano de ${grado}.${transImplicita}
5. ${etExplica.toUpperCase()}: siempre incluye la explicación del docente, coherente con la metodología, y con un recurso creativo que cambie según el tema (organizador gráfico construido en la pizarra con los estudiantes, demostración con material concreto, lectura guiada del libro con subrayado, analogía con algo cotidiano, dramatización, modelado paso a paso de un ejemplo, entre otros). En el "material" de esta etapa escribe las ideas clave que el docente explica, con su contenido real (no solo los títulos), y cómo queda el organizador o el ejemplo modelado.
6. METODOLOGÍA: ${metRegla}.
7. INSERCIONES: ${insRegla}. Las inserciones van IMPLÍCITAS: se integran dentro del inicio, los ejemplos, los problemas, los textos y las preguntas, de modo que el estudiante las trabaja sin que se anuncien. No crees momentos aparte para ellas ni las nombres dentro de los pasos. ${insSiglas.length ? `Al final del paso donde se trabaja cada inserción escribe su sigla entre paréntesis: ${insSiglas.map((x) => `(${x})`).join(", ")}. Usa solo esas siglas` : "No escribas siglas de inserciones"}.
8. COMPETENCIAS: cada competencia de la lista se desarrolla de verdad en al menos un paso, según lo que exige el currículo priorizado: ${compTodas.length ? compTodas.map((c) => `${c}: ${EXIGE[c]}`).join(". ") : "no hay competencias marcadas"}. Al final del paso donde se cumple escribe su sigla entre paréntesis: (CC), (CM), (CD) o (CS). Usa solo las siglas de las competencias de la lista. Las siglas de competencias no tienen relación con los códigos de las destrezas (CS.3.1.4 es una destreza de Estudios Sociales, no la competencia socioemocional). La competencia digital solo se marca cuando el estudiante interactúa con una herramienta digital.
9. HERRAMIENTAS DIGITALES: ${digRegla}. ${casaRegla}.
10. ${secundarias.length ? `TRANSVERSALIZACIÓN DE DESTREZAS: la destreza principal lleva el peso de la clase. Cada destreza secundaria se integra usando su contenido como tema o contexto de los textos, problemas, ejemplos o del producto de la clase (por ejemplo, si la secundaria es de Estudios Sociales, el texto que se lee o el debate trata ese contenido), de modo que se trabaje de verdad en al menos un paso y no como una mención forzada. Sus inserciones y competencias aparecen de forma más ligera. En "destrezas_transversales" indica en qué etapa y actividad se trabaja cada una` : `No hay destrezas secundarias: deja "destrezas_transversales" como lista vacía`}.
11. DESAGREGACIÓN DE LA DESTREZA: ${desagDocente ? 'el docente ya escribió la destreza desagregada; cópiala sin cambios en "destreza_desagregada" y planifica para ese alcance' : 'desagrega la destreza principal para lo que realmente se puede lograr en esta clase con este tema y este tiempo, manteniendo su estructura (habilidad + contenido + nivel de complejidad) y sin inventar códigos. Si ya es acotada, repítela'}.
12. DESAGREGACIÓN DEL INDICADOR: en "indicador_desagregado" redacta el indicador elegido acotado a lo que se planificó en las actividades y estrategias de esta clase, con la estructura del indicador oficial (qué logra el estudiante, cómo lo demuestra y en qué contexto). La rúbrica responde a este indicador desagregado.
13. TAXONOMÍA DE MARZANO: los verbos y la demanda cognitiva de cada etapa corresponden a su "nivel_marzano" (Recuperación: reconocer, recordar, ejecutar. Comprensión: integrar, simbolizar. Análisis: comparar, clasificar, analizar errores, generalizar, especificar. Utilización del conocimiento: tomar decisiones, resolver problemas, experimentar, investigar).
13b. RIGOR: los contenidos de las disciplinas (historia, ciencias, matemática, lengua) deben ser correctos y fieles al currículo. No inventes datos, fechas, nombres ni hechos, y no suavices ni idealices procesos históricos: si la destreza habla de dominación, conquista o conflicto, el texto lo presenta como tal.
14. Cada etapa tiene sus tres principios DUA detallados. Distribuye el tiempo de modo que la suma sea exactamente ${minutos}. Genera el objetivo coherente con la destreza y el tema. Redacción humanizada y pedagógicamente sólida.
15. RECURSOS: detalla cada recurso con cantidad y cómo se prepara o se usa. Si un recurso se beneficia de material de apoyo en internet, escribe en "busqueda" las palabras exactas para encontrarlo. NO escribas direcciones web. RÚBRICA: de 3 a 4 criterios derivados del indicador desagregado y de las actividades, con descriptores observables y distintos en cada nivel de la escala ecuatoriana.${preferencias ? `
15b. INDICACIONES DEL DOCENTE: respeta sus preferencias y usa el contenido de su libro como base de textos, ejemplos y ejercicios, siempre que no contradigan el currículo ni estas reglas.` : ""}${neeReglas}

Responde ÚNICAMENTE con este JSON exacto (sin markdown, sin texto adicional):
{
  "tema": "tema de la clase",
  "objetivo": "objetivo coherente con la destreza",
  "destreza_desagregada": "destreza desagregada para el alcance de esta clase",
  "indicador_desagregado": "indicador desagregado según lo planificado",
  "ejes_transversales": [
    { "insercion": "nombre de la inserción", "contenido": "contenido que se transversaliza" }
  ],
  "destrezas_transversales": [
    { "codigo": "código de la destreza secundaria", "integracion": "etapa y actividad donde se trabaja" }
  ],
  "inicio_tipo": "Situación de aprendizaje, Juego, Lectura, Experimento u otro",
  "inicio_texto": "contenido completo del inicio de la clase",
  "preguntas_reflexion": ["pregunta literal", "pregunta inferencial", "pregunta crítico-valorativa"],
  "etapas": {
    ${etapas.map(etapaJson).join(",\n    ")}
  },
  "tarea_casa": { "consigna": "", "herramienta": "" },
  "recursos": [
    { "nombre": "recurso con su cantidad", "detalle": "cómo se prepara o se usa en la clase", "busqueda": "palabras para buscar material de apoyo, o cadena vacía" }
  ],
  "rubrica": [
    { "criterio": "criterio 1", "dar": "descriptor de Domina los aprendizajes requeridos", "aar": "descriptor de Alcanza los aprendizajes requeridos", "paar": "descriptor de Está próximo a alcanzar los aprendizajes requeridos", "naar": "descriptor de No alcanza los aprendizajes requeridos" },
    { "criterio": "criterio 2", "dar": "...", "aar": "...", "paar": "...", "naar": "..." },
    { "criterio": "criterio 3", "dar": "...", "aar": "...", "paar": "...", "naar": "..." }
  ],
  "tecnica": "técnica de evaluación apropiada para el subnivel",
  "instrumento": "instrumento de evaluación apropiado para el subnivel"${neeJson}
}`;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "API key no configurada en el servidor." }) };

    const llamar = (model) => fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 10000,
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Eres PLANIA, experta en currículo ecuatoriano, secuencias ERCA y ACC, y DUA. Escribes actividades concretas que un docente puede aplicar mañana mismo. Respondes ÚNICAMENTE con JSON válido sin markdown." },
          { role: "user", content: prompt }
        ]
      }),
    });
    // gpt-4.1 sigue mejor las instrucciones largas; si la cuenta no lo tiene, se usa gpt-4o.
    let response = await llamar(process.env.PLANIA_MODELO || "gpt-4.1");
    if (!response.ok && [400, 403, 404].includes(response.status)) response = await llamar("gpt-4o");

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
    if (!Array.isArray(plan.ejes_transversales)) plan.ejes_transversales = [];
    // Las inserciones de las destrezas secundarias también se declaran.
    secundarias.forEach((x) => x.ejes.forEach((e) => {
      if (!plan.ejes_transversales.some((y) => y.insercion === e.insercion && y.contenido === e.contenido)) plan.ejes_transversales.push(Object.assign({ secundaria: x.codigo || true }, e));
    }));
    if (!secundarias.length) plan.destrezas_transversales = [];
    if (!(digitales === "no" && compTodas.includes("digital"))) plan.tarea_casa = null;
    // Quita las siglas de competencias que no corresponden a esta planificación.
    const validas = new Set([...compTodas.map((c) => SIGLA[c]), ...insSiglas]);
    const limpiaSiglas = (t) => typeof t === "string" ? t.replace(/\s*\(((?:CC|CM|CD|CS|ES|EDS|ESV|ECEI|ESI|EF)(?:\s*[,y]\s*(?:CC|CM|CD|CS|ES|EDS|ESV|ECEI|ESI|EF))*)\)/g, (m, g) => {
      const ok = [...new Set(g.split(/\s*[,y]\s*/).filter((x) => validas.has(x)))];
      return ok.length ? " " + ok.map((x) => `(${x})`).join(" ") : "";
    }) : t;
    if (plan.etapas && typeof plan.etapas === "object") Object.values(plan.etapas).forEach((e) => {
      if (e && Array.isArray(e.pasos)) e.pasos = e.pasos.map(limpiaSiglas);
      if (e && typeof e.material === "string") e.material = limpiaSiglas(e.material);
    });
    if (plan.tarea_casa && plan.tarea_casa.consigna) plan.tarea_casa.consigna = limpiaSiglas(plan.tarea_casa.consigna);
    if (Array.isArray(plan.preguntas_reflexion)) plan.preguntas_reflexion = plan.preguntas_reflexion.map(limpiaSiglas).slice(0, 4);
    plan.inicio_elegido = inicio;
    plan.inserciones_siglas = insSiglas;
    plan.origen_destreza = deMapa ? "mapa" : "manual";
    if (deMapa) { plan.codigo_destreza = txt(b.codigo, 20); plan.criterio = txt(b.criterio, 20); }
    if (desagDocente) plan.destreza_desagregada = desagDocente;
    plan.desagregacion_origen = desagDocente ? "docente" : "plania";
    plan.competencias_plan = compTodas;
    plan.secundarias = secundarias.map((x) => ({ codigo: x.codigo, asignatura: x.asignatura, destreza: x.destreza }));
    const plan_id = crypto.randomUUID();
    const usuario_id = (aut.usuario && aut.usuario.uid) || "";

    const datos = { subnivel, asignatura, grado, periodos, minutos, secuencia, trimestre: txt(b.trimestre, 20), area: txt(b.area, 80),
      institucion: txt(b.institucion, 150), periodo_lectivo: txt(b.periodo_lectivo, 30), unidad: txt(b.unidad, 20), titulo_unidad: txt(b.titulo_unidad, 150),
      metodologia: metStr, destreza, indicador, tema, codigo: txt(b.codigo, 20), criterio: txt(b.criterio, 20), origen_destreza: plan.origen_destreza,
      competencias: compTodas, inserciones, digitales, inicio, preferencias, nee_ajuste: neeAjuste, nee_adaptacion: neeAdaptacion, destreza_desagregada: desagDocente };

    const [, uso] = await Promise.all([
      registrar({
        tipo: "planificacion",
        fecha: new Date().toISOString(),
        plan_id,
        anon_id: txt(b.anon_id, 60),
        usuario_id,
        subnivel, asignatura, grado, periodos, minutos, secuencia,
        trimestre: datos.trimestre, institucion: datos.institucion, area: datos.area, periodo_lectivo: datos.periodo_lectivo,
        unidad: datos.unidad, titulo_unidad: datos.titulo_unidad,
        metodologia: metStr,
        competencias: compStr,
        inserciones: insStr,
        destreza, indicador, tema,
        codigo: datos.codigo,
        secundarias: secundarias.map((x) => x.codigo || x.destreza.slice(0, 60)).join(" | "),
        herramientas_digitales: digitales,
        inicio,
        preferencias,
        nee_ajuste: neeAjuste,
        nee_adaptacion: neeAdaptacion,
        tecnica: txt(plan.tecnica, 200),
        instrumento: txt(plan.instrumento, 200),
        valor: "",
        plan_json: JSON.stringify(plan),
      }),
      cuenta("consumir", token, { preferencias, registro: { plan_id, datos, plan } }).catch(() => ({ usuario: null })),
    ]);
    return { statusCode: 200, headers, body: JSON.stringify({ plan, plan_id, usuario: (uso && uso.usuario) || aut.usuario }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || "Error interno." }) };
  }
};
