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

// Para empezar un sorteo nuevo desde cero, cambia este número.
const SORTEO_ID = 1;
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
 * Opciones válidas para "quien":
 * - no puede sacarse a sí mismo
 * - no puede sacar a alguien ya escogido
 * - no puede dejar a la última persona con solo ella misma como opción
 */
function opcionesValidas(quien, asignaciones) {
  const escogidos = new Set(Object.values(asignaciones));
  const pendientes = PARTICIPANTES.filter(p => !(p in asignaciones));
  const disponibles = PARTICIPANTES.filter(p => !escogidos.has(p));
  const quedanDar = pendientes.filter(p => p !== quien);

  return disponibles
    .filter(p => p !== quien)
    .filter(candidato => {
      const quedanRecibir = disponibles.filter(p => p !== candidato);
      const atrapado =
        quedanDar.length === 1 &&
        quedanRecibir.length === 1 &&
        quedanDar[0] === quedanRecibir[0];
      return !atrapado;
    });
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

  // Varias personas pueden girar a la vez: se reintenta si alguien guardó primero
  for (let intento = 0; intento < 8; intento++) {
    const actual = await store.getWithMetadata(key, { type: "json" });
    const asignaciones = actual?.data ?? {};

    // Ya había girado: se le muestra el mismo resultado
    if (quien in asignaciones) {
      return respuesta({ amigo: asignaciones[quien] });
    }

    const opciones = opcionesValidas(quien, asignaciones);
    if (opciones.length === 0) {
      return respuesta({ error: "No hay opciones disponibles." }, 409);
    }
    const elegido = opciones[Math.floor(Math.random() * opciones.length)];
    const nuevas = { ...asignaciones, [quien]: elegido };

    const resultado = actual
      ? await store.set(key, JSON.stringify(nuevas), { onlyIfMatch: actual.etag })
      : await store.set(key, JSON.stringify(nuevas), { onlyIfNew: true });

    if (resultado.modified) {
      return respuesta({ amigo: elegido });
    }
  }

  return respuesta({ error: "Mucha gente a la vez. Intenta de nuevo." }, 503);
};
