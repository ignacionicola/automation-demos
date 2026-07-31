/**
 * Validación y registro de visitas a propiedades.
 *
 * La fecha y la hora llegan ya extraídas por el clasificador (Claude las
 * devuelve como `fecha_visita` en formato YYYY-MM-DD y `hora_visita` en HH:MM).
 * Acá se valida que sean reales, futuras y dentro del horario de atención.
 *
 * `ahora` se recibe por parámetro en vez de llamar a new Date() adentro, para
 * que los tests sean determinísticos.
 */

const HORA_APERTURA = 9;
const HORA_CIERRE = 19;
const SABADO_CIERRE = 13;

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function parsearFecha(valor) {
  if (typeof valor !== 'string') return null;
  const match = valor.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const [, anio, mes, dia] = match.map(Number);
  const fecha = new Date(anio, mes - 1, dia);
  // Rechaza fechas tipo 2026-02-31, que Date "corrige" silenciosamente.
  if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) {
    return null;
  }
  return { anio, mes, dia };
}

function parsearHora(valor) {
  if (typeof valor !== 'string') return null;
  const match = valor.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const horas = Number(match[1]);
  const minutos = Number(match[2]);
  if (horas < 0 || horas > 23 || minutos < 0 || minutos > 59) return null;
  return { horas, minutos };
}

function cierreDelDia(diaSemana) {
  if (diaSemana === 0) return null; // domingo cerrado
  return diaSemana === 6 ? SABADO_CIERRE : HORA_CIERRE;
}

function formatearFechaLegible(cuando) {
  return `${DIAS[cuando.getDay()]} ${cuando.getDate()} de ${MESES[cuando.getMonth()]}`;
}

function formatearHoraLegible(cuando) {
  const minutos = String(cuando.getMinutes()).padStart(2, '0');
  return `${cuando.getHours()}:${minutos}`;
}

/**
 * @param {object} entidades  { fecha_visita, hora_visita, referencia_propiedad }
 * @param {{ahora?: Date|string}} opciones
 * @returns {{valido: boolean, motivo: string, cuando: Date|null, faltante: string[]}}
 */
function parseVisitRequest(entidades, opciones) {
  const datos = entidades && typeof entidades === 'object' ? entidades : {};
  const ahora = opciones && opciones.ahora ? new Date(opciones.ahora) : new Date();

  const fecha = parsearFecha(datos.fecha_visita);
  const hora = parsearHora(datos.hora_visita);

  const faltante = [];
  if (!fecha) faltante.push('fecha');
  if (!hora) faltante.push('hora');
  if (faltante.length > 0) {
    return { valido: false, motivo: 'datos_incompletos', cuando: null, faltante };
  }

  const cuando = new Date(fecha.anio, fecha.mes - 1, fecha.dia, hora.horas, hora.minutos);

  if (cuando.getTime() <= ahora.getTime()) {
    return { valido: false, motivo: 'fecha_pasada', cuando, faltante: ['fecha'] };
  }

  const cierre = cierreDelDia(cuando.getDay());
  if (cierre === null) {
    return { valido: false, motivo: 'domingo_cerrado', cuando, faltante: ['fecha'] };
  }
  if (hora.horas < HORA_APERTURA || hora.horas >= cierre) {
    return { valido: false, motivo: 'fuera_de_horario', cuando, faltante: ['hora'] };
  }

  return { valido: true, motivo: 'ok', cuando, faltante: [] };
}

/** Fila que se guarda en la planilla de visitas. */
function buildVisitRecord(validacion, contacto, entidades) {
  const datos = entidades && typeof entidades === 'object' ? entidades : {};
  return {
    telefono: (contacto && contacto.telefono) || '',
    nombre: (contacto && contacto.nombre) || 'Sin nombre',
    propiedad: datos.referencia_propiedad || 'A definir',
    fechaIso: validacion.cuando ? validacion.cuando.toISOString() : null,
    fechaLegible: validacion.cuando ? formatearFechaLegible(validacion.cuando) : null,
    horaLegible: validacion.cuando ? formatearHoraLegible(validacion.cuando) : null,
    estado: 'pendiente_de_confirmacion',
  };
}

/** Mensaje al cliente según el resultado de la validación. */
function formatSchedulingReply(validacion, registro, contexto) {
  const agencia = (contexto && contexto.agencia) || 'la inmobiliaria';

  if (validacion.valido) {
    const propiedad =
      registro.propiedad === 'A definir'
        ? 'la propiedad que elijas'
        : `la propiedad *${registro.propiedad}*`;

    return [
      `¡Listo! Anoté tu visita a ${propiedad} para el *${registro.fechaLegible} a las ${registro.horaLegible} hs* 📅`,
      '',
      `Un asesor de ${agencia} te confirma por acá dentro de las próximas horas.`,
      '',
      'Si necesitás cambiarla o cancelarla, avisame y la reprogramamos sin problema.',
    ].join('\n');
  }

  if (validacion.motivo === 'datos_incompletos') {
    const pide =
      validacion.faltante.length === 2
        ? '¿qué día y a qué hora te queda cómodo?'
        : validacion.faltante[0] === 'fecha'
          ? '¿qué día te queda cómodo?'
          : '¿a qué hora te queda cómodo?';

    return [
      `¡Dale, coordinamos la visita! 🏠`,
      '',
      `Para agendarla necesito ${pide}`,
      '',
      'Atendemos de *lunes a viernes de 9 a 19 hs* y los *sábados de 9 a 13 hs*.',
    ].join('\n');
  }

  if (validacion.motivo === 'fecha_pasada') {
    return 'Esa fecha ya pasó 😅 ¿Me pasás un día de acá en adelante y coordinamos?';
  }

  if (validacion.motivo === 'domingo_cerrado') {
    return 'Los domingos no atendemos 🙈 ¿Te sirve algún día de *lunes a viernes de 9 a 19 hs*, o el *sábado de 9 a 13 hs*?';
  }

  return [
    'Ese horario nos queda fuera de la atención 🕐',
    '',
    'Podemos coordinar de *lunes a viernes de 9 a 19 hs* o los *sábados de 9 a 13 hs*. ¿Cuál te viene bien?',
  ].join('\n');
}

module.exports = {
  parseVisitRequest,
  buildVisitRecord,
  formatSchedulingReply,
  formatearFechaLegible,
  formatearHoraLegible,
  HORA_APERTURA,
  HORA_CIERRE,
  SABADO_CIERRE,
};
