import { getStore } from "@netlify/blobs";

// =====================================================
//  AQUÍ AGREGAS LOS NOMBRES (uno por línea, entre comillas
//  y separados por comas). Cámbialos por los tuyos.
//  Estos nombres viven en el servidor: nadie los ve en la web.
// =====================================================
const PARTICIPANTES = [
  "Geraldin",
  "Wilson",
  "Camila",
  "Carlos",
  "Gloria",
  "Elena",
  "Sergio",
  "Marian",
];

// Para hacer un sorteo nuevo, sube este número (2, 3, 4...) y vuelve a publicar.
// El sorteo nuevo evita repetir las parejas del sorteo anterior.
const SORTEO_ID = 3;

// true = en un sorteo nuevo nadie recibe a la misma persona del sorteo anterior
const EVITAR_REPETIDOS = true;
// =====================================================

export const config = { path: "/api/sortear" };

// Compara nombres sin importar mayúsculas ni tildes
const normalizar = s =>
  s.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const buscarParticipante = texto =>
  PARTICIPANTES.find(p => normalizar(p) === normalizar(texto));

const respuesta = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/**
 * Genera el sorteo completo de una vez (quién le da a quién):
 * - nadie se saca a sí mismo
 * - nadie sale repetido
 * - nadie recibe a la misma persona del sorteo anterior
 */
function generarSorteo(previo) {
  for (let intento = 0; intento < 10000; intento++) {
    const receptores = [...PARTICIPANTES];

    // Mezcla aleatoria (Fisher-Yates)
    for (let i = receptores.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [receptores[i], receptores[j]] = [receptores[j], receptores[i]];
    }

    const valido = PARTICIPANTES.every(
      (dador, i) => receptores[i] !== dador && previo[dador] !== receptores[i]
    );
    if (valido) {
      return Object.fromEntries(PARTICIPANTES.map((dador, i) => [dador, receptores[i]]));
    }
  }
  return null;
}

export default async (req) => {
  if (req.method !== "POST") {
    return respuesta({ error: "Método no permitido." }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return respuesta({ error: "Solicitud inválida." }, 400);
  }

  if (PARTICIPANTES.length < 3) {
    return respuesta({ error: "Faltan participantes (mínimo 3)." }, 500);
  }

  const quien = buscarParticipante(String(body?.nombre ?? ""));
  if (!quien) {
    return respuesta({ error: "Este enlace no es válido." }, 404);
  }

  const store = getStore({ name: "amigo-secreto", consistency: "strong" });
  const key = `sorteo-${SORTEO_ID}`;

  let sorteo = await store.get(key, { type: "json" });

  // El sorteo se crea una sola vez, cuando alguien gira por primera vez
  if (!sorteo) {
    let previo = {};
    if (EVITAR_REPETIDOS && SORTEO_ID > 1) {
      previo = (await store.get(`sorteo-${SORTEO_ID - 1}`, { type: "json" })) ?? {};
    }

    const nuevo = generarSorteo(previo);
    if (!nuevo) {
      return respuesta({ error: "No se pudo generar el sorteo." }, 500);
    }

    // Si dos personas giran a la vez, gana la primera y la otra usa ese mismo sorteo
    const guardado = await store.set(key, JSON.stringify(nuevo), { onlyIfNew: true });
    sorteo = guardado.modified ? nuevo : await store.get(key, { type: "json" });
  }

  return respuesta({ amigo: sorteo[quien] });
};
