/**
 * El evento de Google Calendar de una visita, y la búsqueda de horarios libres
 * cuando el que pidió el cliente está ocupado.
 *
 * Separado de scheduling.js a propósito: ahí vive la política de la
 * inmobiliaria (qué días atiende, qué datos hace falta pedir) y acá la forma
 * que espera Calendar. Una cosa cambia porque la agencia cambia de horario, la
 * otra porque cambia la API.
 *
 * Este módulo no llama a ninguna API: arma datos planos y decide sobre los
 * bloques ocupados que ya trajo el nodo de Calendar. Así se puede probar
 * entero sin red y sin credenciales.
 */

// En una sola línea a propósito: build-workflow.js saca los require() con un
// filtro línea por línea, y uno partido en varias sobreviviría a la inyección.
const { ZONA_HORARIA, aHoraIso, aRfc3339, aInstante, sumarMinutos, conHora, esFechaValida } = require('./localTime');

// Una visita a una propiedad: alcanza para recorrerla y hacer preguntas.
const DURACION_VISITA_MINUTOS = 45;

// Cada media hora es la grilla con la que piensa una inmobiliaria; ofrecer
// "16:07" porque ahí entra justo se ve automático y no lo elige nadie.
const PASO_ALTERNATIVAS_MINUTOS = 30;

// Tres opciones alcanzan para que el cliente elija sin leer una lista larga.
const MAXIMO_ALTERNATIVAS = 3;

// Deliberadamente laxo: acá no se decide si el mail existe, solo si tiene
// forma de mail. Quien lo confirma de verdad es Google al mandar la
// invitación, y una regex más estricta rechazaría direcciones válidas.
const FORMA_DE_EMAIL = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

function esEmailValido(valor) {
  return typeof valor === 'string' && FORMA_DE_EMAIL.test(valor.trim());
}

/** Devuelve el mail normalizado, o null si no tiene forma de mail. */
function normalizarEmail(valor) {
  return esEmailValido(valor) ? valor.trim().toLowerCase() : null;
}

/**
 * Bloques ocupados tal como los devuelve el nodo de Calendar con
 * `outputFormat: bookedSlots`: `[{ start, end }]` en RFC3339.
 *
 * Se descarta en silencio cualquier fila que no tenga las dos fechas: si
 * Calendar falló, el nodo emite un item con `error` en vez de bloques, y ese
 * caso lo resuelve quien llama decidiendo si agenda igual — acá tratarlo como
 * "no hay nada ocupado" sería mentir.
 */
function bloquesOcupados(filas) {
  return (Array.isArray(filas) ? filas : [])
    .map((fila) => ({
      desde: Date.parse((fila && fila.start) || ''),
      hasta: Date.parse((fila && fila.end) || ''),
    }))
    .filter((bloque) => !Number.isNaN(bloque.desde) && !Number.isNaN(bloque.hasta));
}

/** ¿El rango [inicio, fin) pisa algún bloque ocupado? */
function seSolapa(ocupados, inicio, fin) {
  const desde = aInstante(inicio);
  const hasta = aInstante(fin);
  if (Number.isNaN(desde) || Number.isNaN(hasta)) return false;

  // Dos rangos se solapan si cada uno empieza antes de que termine el otro.
  // Con los extremos abiertos, una visita de 15:00 a 15:45 y otra de 15:45 a
  // 16:30 no se pisan: son consecutivas.
  return ocupados.some((bloque) => bloque.desde < hasta && bloque.hasta > desde);
}

/**
 * Horarios libres del mismo día, ordenados por cercanía al que pidió el
 * cliente — si pidió las 16 y hay hueco a las 15:30 y a las 10, lo que quiere
 * escuchar primero es 15:30.
 *
 * @param {Array} ocupados       bloques de `bloquesOcupados`
 * @param {Date} cuando          hora de pared pedida por el cliente
 * @param {object} opciones      { apertura, cierre, duracionMinutos, paso, maximo, ahora }
 * @returns {Date[]}             horas de pared libres
 */
function buscarAlternativas(ocupados, cuando, opciones) {
  const config = opciones || {};
  if (!esFechaValida(cuando)) return [];

  const apertura = Number.isInteger(config.apertura) ? config.apertura : 9;
  const cierre = Number.isInteger(config.cierre) ? config.cierre : 19;
  const duracion = config.duracionMinutos || DURACION_VISITA_MINUTOS;
  const paso = config.paso || PASO_ALTERNATIVAS_MINUTOS;
  const maximo = config.maximo || MAXIMO_ALTERNATIVAS;
  const ahora = config.ahora ? aInstante(new Date(config.ahora)) : Date.now();

  const bloques = Array.isArray(ocupados) ? ocupados : [];
  const limite = conHora(cuando, cierre, 0);
  const candidatos = [];

  for (let inicio = conHora(cuando, apertura, 0); ; inicio = sumarMinutos(inicio, paso)) {
    const fin = sumarMinutos(inicio, duracion);
    // La visita tiene que terminar antes de cerrar, no solo empezar antes.
    if (fin.getTime() > limite.getTime()) break;

    if (inicio.getTime() === cuando.getTime()) continue;
    if (aInstante(inicio) <= ahora) continue;
    if (seSolapa(bloques, inicio, fin)) continue;

    candidatos.push(inicio);
  }

  const pedido = cuando.getTime();
  return candidatos
    .sort((a, b) => Math.abs(a.getTime() - pedido) - Math.abs(b.getTime() - pedido))
    .slice(0, maximo)
    .sort((a, b) => a.getTime() - b.getTime());
}

/** Las alternativas como las lee el cliente: ["15:00", "17:30"]. */
function formatearAlternativas(alternativas) {
  return (Array.isArray(alternativas) ? alternativas : []).map(aHoraIso).filter(Boolean);
}

function normalizarTexto(valor) {
  return String(valor || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    // Saca las tildes: "Río Tercero" y "Rio Tercero" son el mismo lugar.
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Ubica la propiedad de la que habla el cliente dentro del catálogo.
 *
 * El clasificador devuelve el código cuando puede resolverlo contra el
 * contexto, pero nadie dice "la INM-013" en voz alta: lo normal es "el de Las
 * Flores". Cuando llega eso, se busca por barrio — y solo si hay una sola
 * propiedad en ese barrio, porque con dos no se sabe cuál quiso decir y es
 * mejor un evento sin dirección que uno con la dirección equivocada.
 *
 * @returns {object|null} la propiedad, o null si no se puede identificar una sola
 */
function buscarPropiedad(referencia, propiedades) {
  const catalogo = Array.isArray(propiedades) ? propiedades : [];
  const buscado = normalizarTexto(referencia);
  if (!buscado || buscado === 'a definir') return null;

  const porCodigo = catalogo.find((fila) => normalizarTexto(fila.id) === buscado);
  if (porCodigo) return porCodigo;

  // El código puede venir embebido en una frase ("quiero ver la INM-013").
  const mencionado = catalogo.find((fila) => fila.id && buscado.includes(normalizarTexto(fila.id)));
  if (mencionado) return mencionado;

  const porBarrio = catalogo.filter((fila) => {
    const barrio = normalizarTexto(fila.barrio);
    return barrio && buscado.includes(barrio);
  });
  return porBarrio.length === 1 ? porBarrio[0] : null;
}

function describirPropiedad(propiedad, referencia) {
  if (propiedad && propiedad.id) {
    return [propiedad.id, propiedad.tipo, propiedad.barrio].filter(Boolean).join(' · ');
  }
  return referencia && referencia !== 'A definir' ? referencia : 'Propiedad a definir';
}

function direccionDe(propiedad) {
  if (!propiedad) return '';
  return [propiedad.direccion, propiedad.barrio, propiedad.ciudad].filter(Boolean).join(', ');
}

/**
 * El evento listo para el nodo de Calendar. Devuelve datos planos: quien llama
 * los mapea a los campos del nodo.
 *
 * @param {Date} cuando        hora de pared de la visita
 * @param {object} registro    lo que devuelve buildVisitRecord
 * @param {object} opciones    { propiedad, agencia, duracionMinutos }
 */
function buildCalendarEvent(cuando, registro, opciones) {
  if (!esFechaValida(cuando)) return null;

  const config = opciones || {};
  const datos = registro || {};
  const propiedad = config.propiedad || null;
  const duracion = config.duracionMinutos || DURACION_VISITA_MINUTOS;
  const fin = sumarMinutos(cuando, duracion);
  const invitado = normalizarEmail(datos.email);

  const descripcion = [
    `Visita coordinada por WhatsApp con ${config.agencia || 'la inmobiliaria'}.`,
    '',
    `Cliente: ${datos.nombre || 'Sin nombre'}`,
    `Teléfono: ${datos.telefono || 'sin registrar'}`,
    invitado ? `Email: ${invitado}` : 'Email: no lo dejó',
    `Propiedad: ${describirPropiedad(propiedad, datos.propiedad)}`,
  ].join('\n');

  return {
    inicio: aRfc3339(cuando),
    fin: aRfc3339(fin),
    zonaHoraria: ZONA_HORARIA,
    resumen: `Visita — ${describirPropiedad(propiedad, datos.propiedad)}`,
    descripcion,
    ubicacion: direccionDe(propiedad),
    invitados: invitado ? [invitado] : [],
    // Ventana para consultar la agenda: el día entero. Recortarla al horario de
    // atención escondería una visita cargada a mano fuera de hora, que ocupa
    // igual al asesor.
    ventanaDia: {
      desde: aRfc3339(conHora(cuando, 0, 0)),
      hasta: aRfc3339(conHora(sumarMinutos(conHora(cuando, 0, 0), 24 * 60), 0, 0)),
    },
    duracionMinutos: duracion,
  };
}

module.exports = {
  DURACION_VISITA_MINUTOS,
  PASO_ALTERNATIVAS_MINUTOS,
  MAXIMO_ALTERNATIVAS,
  esEmailValido,
  normalizarEmail,
  bloquesOcupados,
  buscarPropiedad,
  seSolapa,
  buscarAlternativas,
  formatearAlternativas,
  describirPropiedad,
  direccionDe,
  buildCalendarEvent,
};
