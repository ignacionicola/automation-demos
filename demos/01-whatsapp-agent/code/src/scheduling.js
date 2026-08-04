/**
 * Validación y registro de visitas a propiedades.
 *
 * La fecha y la hora llegan ya extraídas por el clasificador (Claude las
 * devuelve como `fecha_visita` en formato YYYY-MM-DD y `hora_visita` en HH:MM).
 * Acá se valida que sean reales, futuras y dentro del horario de atención.
 *
 * Lo que sí se pide, si no vino, es QUÉ propiedad quiere ver: sin eso el dueño
 * recibe un turno sin saber qué mostrar ni adónde ir. Y como el cliente puede
 * no haber elegido todavía, la pregunta ofrece mostrarle el catálogo — que es
 * de lo que vino a hablar.
 *
 * El mail, en cambio, es opcional. La invitación de Google viaja por mail y de
 * WhatsApp solo tenemos el teléfono, pero el cliente ya recibe su confirmación
 * por el chat: pedírselo agrega un ida y vuelta para darle algo que ya tiene, y
 * bloquear la reserva por no tenerlo sería lo peor de los dos mundos. Si lo
 * menciona, se lo invita; si no, se agenda igual.
 *
 * `ahora` se recibe por parámetro en vez de llamar a new Date() adentro, para
 * que los tests sean determinísticos. Quien llama le pasa la hora de pared de
 * Córdoba (ver localTime.js), no la del proceso.
 */

const { normalizarEmail } = require('./calendarEvent');
const { aRfc3339 } = require('./localTime');
const { NEGOCIO_POR_DEFECTO, describirHorarios } = require('./businessConfig');

// Los valores por defecto siguen acá para que todo ande sin planilla, pero el
// horario real sale de la pestaña "negocio". No puede estar en dos lugares:
// si la inmobiliaria pone "9 a 20" en su planilla y estas constantes siguen
// diciendo 19, el bot le contesta un horario y le rechaza otro.
const HORA_APERTURA = NEGOCIO_POR_DEFECTO.horaApertura;
const HORA_CIERRE = NEGOCIO_POR_DEFECTO.horaCierre;
const SABADO_CIERRE = NEGOCIO_POR_DEFECTO.horaCierreSabado;

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

/**
 * A qué hora cierra ese día, o null si no se atiende.
 *
 * @param {number} diaSemana  0 = domingo
 * @param {object} [negocio]  config de la planilla; sin ella, los defaults
 */
function cierreDelDia(diaSemana, negocio) {
  const config = negocio || NEGOCIO_POR_DEFECTO;
  if (diaSemana === 0) return null; // domingo cerrado
  return diaSemana === 6 ? config.horaCierreSabado : config.horaCierre;
}

function formatearFechaLegible(cuando) {
  return `${DIAS[cuando.getDay()]} ${cuando.getDate()} de ${MESES[cuando.getMonth()]}`;
}

function formatearHoraLegible(cuando) {
  const minutos = String(cuando.getMinutes()).padStart(2, '0');
  return `${cuando.getHours()}:${minutos}`;
}

/**
 * @param {object} entidades  { fecha_visita, hora_visita, email, referencia_propiedad }
 * @param {{ahora?: Date|string}} opciones
 * @returns {{valido: boolean, motivo: string, cuando: Date|null, faltante: string[]}}
 */
function parseVisitRequest(entidades, opciones) {
  const datos = entidades && typeof entidades === 'object' ? entidades : {};
  const config = (opciones && opciones.negocio) || NEGOCIO_POR_DEFECTO;
  const ahora = opciones && opciones.ahora ? new Date(opciones.ahora) : new Date();

  const fecha = parsearFecha(datos.fecha_visita);
  const hora = parsearHora(datos.hora_visita);
  const sinPropiedad = String(datos.referencia_propiedad || '').trim().length === 0;

  const faltante = [];
  if (!fecha) faltante.push('fecha');
  if (!hora) faltante.push('hora');
  if (faltante.length > 0) {
    // Si además no sabemos qué quiere ver, se avisa acá mismo en vez de
    // preguntarlo en el mensaje siguiente: son dos datos que el cliente tiene
    // igual de a mano, y encadenar preguntas de a una cansa.
    return { valido: false, motivo: 'datos_incompletos', cuando: null, faltante, sinPropiedad };
  }

  const cuando = new Date(fecha.anio, fecha.mes - 1, fecha.dia, hora.horas, hora.minutos);

  if (cuando.getTime() <= ahora.getTime()) {
    return { valido: false, motivo: 'fecha_pasada', cuando, faltante: ['fecha'] };
  }

  const cierre = cierreDelDia(cuando.getDay(), config);
  if (cierre === null) {
    // Qué día está cerrado depende de la planilla: el domingo siempre, y el
    // sábado si la inmobiliaria puso "cerrado". El mensaje tiene que nombrar
    // el día correcto, no dar por sentado que es domingo.
    return { valido: false, motivo: 'dia_cerrado', cuando, faltante: ['fecha'], dia: DIAS[cuando.getDay()] };
  }
  if (hora.horas < config.horaApertura || hora.horas >= cierre) {
    return { valido: false, motivo: 'fuera_de_horario', cuando, faltante: ['hora'] };
  }

  // Recién acá, con el horario ya validado: no tiene sentido preguntar qué
  // quiere ver para un turno que se va a rechazar igual.
  if (sinPropiedad) {
    return { valido: false, motivo: 'falta_propiedad', cuando, faltante: ['propiedad'] };
  }

  return { valido: true, motivo: 'ok', cuando, faltante: [] };
}

/**
 * Marca la visita como imposible porque la agenda ya tiene ese horario tomado.
 * No lo decide parseVisitRequest porque depende de la agenda real, que se
 * consulta después; el resultado tiene la misma forma para que el resto del
 * flujo no distinga entre "no se puede por horario" y "no se puede por agenda".
 *
 * @param {object} validacion   la validación original, ya válida
 * @param {string[]} alternativas horarios libres, formato "HH:MM"
 */
function marcarHorarioOcupado(validacion, alternativas) {
  return {
    ...validacion,
    valido: false,
    motivo: 'horario_ocupado',
    faltante: ['hora'],
    alternativas: Array.isArray(alternativas) ? alternativas : [],
  };
}

/**
 * Fila que se guarda en el registro de visitas.
 *
 * @param {object} [propiedad] la del catálogo, si se pudo identificar. Cambia
 *        qué se guarda y cómo se la nombra: el cliente dijo "el de Las Flores"
 *        y el registro tiene que decir INM-101, pero el mensaje de vuelta no
 *        puede contestarle con un código que él nunca usó.
 */
function buildVisitRecord(validacion, contacto, entidades, propiedad) {
  const datos = entidades && typeof entidades === 'object' ? entidades : {};
  const referencia = datos.referencia_propiedad || 'A definir';
  const ficha = propiedad || null;

  return {
    telefono: (contacto && contacto.telefono) || '',
    nombre: (contacto && contacto.nombre) || 'Sin nombre',
    email: normalizarEmail(datos.email),
    propiedad: ficha ? ficha.id : referencia,
    propiedadTexto: ficha
      ? [ficha.tipo, ficha.barrio && `en ${ficha.barrio}`].filter(Boolean).join(' ')
      : null,
    // Con el offset argentino explícito, no en UTC: la fila tiene que decir la
    // misma hora que el evento de Calendar y que el mensaje al cliente.
    fechaIso: validacion.cuando ? aRfc3339(validacion.cuando) : null,
    fechaLegible: validacion.cuando ? formatearFechaLegible(validacion.cuando) : null,
    horaLegible: validacion.cuando ? formatearHoraLegible(validacion.cuando) : null,
    estado: 'pendiente_de_confirmacion',
  };
}

/** Mensaje al cliente según el resultado de la validación. */
function formatSchedulingReply(validacion, registro, contexto) {
  const negocio = (contexto && contexto.negocio) || NEGOCIO_POR_DEFECTO;
  const agencia = (contexto && contexto.agencia) || negocio.nombre || 'la inmobiliaria';
  const calendario = (contexto && contexto.calendario) || {};
  // El mismo horario que valida los turnos es el que se le cuenta al cliente:
  // salen los dos de la planilla, así que no pueden contradecirse.
  const horarios = describirHorarios(negocio);

  if (validacion.valido) {
    // Se la nombra como la nombraría una persona ("el departamento en Las
    // Flores"), no con el código interno, que el cliente no usó.
    const propiedad =
      registro.propiedad === 'A definir'
        ? 'la propiedad que elijas'
        : `*${registro.propiedadTexto || registro.propiedad}*`;

    const lineas = [
      `¡Listo! Anoté tu visita a ${propiedad} para el *${registro.fechaLegible} a las ${registro.horaLegible} hs* 📅`,
      '',
    ];

    if (calendario.creado && registro.email) {
      // Solo se promete la invitación si Calendar la aceptó de verdad y hay a
      // quién mandársela: es preferible que el cliente espere un llamado a que
      // espere un mail que nunca va a llegar.
      lineas.push(
        `Te mandé la invitación a *${registro.email}*: aceptala y te queda en tu calendario con recordatorio.`,
        '',
        `Ya está agendada en la agenda de ${agencia}.`,
      );
    } else if (calendario.creado) {
      // Sin mail no se ofrece mandárselo: el cliente contestaría con la
      // dirección y ese mensaje, con la fecha todavía en memoria, entraría
      // como un pedido de turno nuevo y agendaría dos veces.
      lineas.push(`Ya quedó agendada en la agenda de ${agencia}.`);
    } else {
      lineas.push(`Un asesor de ${agencia} te confirma por acá dentro de las próximas horas.`);
    }

    lineas.push('', 'Si necesitás cambiarla o cancelarla, avisame y la reprogramamos sin problema.');
    return lineas.join('\n');
  }

  if (validacion.motivo === 'datos_incompletos') {
    const pide =
      validacion.faltante.length === 2
        ? '¿qué día y a qué hora te queda cómodo?'
        : validacion.faltante[0] === 'fecha'
          ? '¿qué día te queda cómodo?'
          : '¿a qué hora te queda cómodo?';

    const lineas = [
      `¡Dale, coordinamos la visita! 🏠`,
      '',
      `Para agendarla, ${pide}`,
      '',
      `Atendemos de ${horarios}.`,
    ];

    if (validacion.sinPropiedad) {
      lineas.push('', 'Contame también qué propiedad te interesa. Si todavía no elegiste, decime qué estás buscando y te muestro las que tengo.');
    }

    return lineas.join('\n');
  }

  if (validacion.motivo === 'falta_propiedad') {
    // La pregunta ofrece las dos salidas: nombrar una propiedad, o pedir que
    // se las muestre. La segunda cae sola en la búsqueda del catálogo, que ya
    // contesta con fotos — y la fecha queda guardada en la memoria mientras
    // tanto, así que el turno no se pierde.
    // Sin pedirle el código: nadie habla así. Alcanza con el barrio o un "el
    // primero", que el clasificador resuelve contra el contexto — la
    // referencia interna la reconstruye el sistema, no el cliente.
    return [
      `Perfecto, me anoto el *${registro.fechaLegible} a las ${registro.horaLegible} hs* 📅`,
      '',
      '¿Cuál querés visitar? Con que me digas el barrio o la referencia alcanza.',
      '',
      'Y si todavía no elegiste, contame qué estás buscando y te muestro las que tengo. 🏠',
    ].join('\n');
  }

  if (validacion.motivo === 'horario_ocupado') {
    const alternativas = Array.isArray(validacion.alternativas) ? validacion.alternativas : [];

    if (alternativas.length === 0) {
      return [
        `Justo ese horario lo tenemos tomado, y el *${registro.fechaLegible}* nos quedó completo 🕐`,
        '',
        `¿Probamos con otro día? Atendemos de ${horarios}.`,
      ].join('\n');
    }

    return [
      `Ese horario ya lo tenemos tomado 🕐`,
      '',
      `Ese mismo *${registro.fechaLegible}* me queda libre:`,
      ...alternativas.map((hora) => `• ${hora} hs`),
      '',
      '¿Cuál te sirve?',
    ].join('\n');
  }

  if (validacion.motivo === 'fecha_pasada') {
    return 'Esa fecha ya pasó 😅 ¿Me pasás un día de acá en adelante y coordinamos?';
  }

  if (validacion.motivo === 'dia_cerrado') {
    const dia = validacion.dia === 'sábado' ? 'sábados' : `${validacion.dia || 'domingo'}s`;
    return `Los ${dia} no atendemos 🙈 ¿Te sirve algún día de ${horarios}?`;
  }

  return [
    'Ese horario nos queda fuera de la atención 🕐',
    '',
    `Podemos coordinar de ${horarios}. ¿Cuál te viene bien?`,
  ].join('\n');
}

module.exports = {
  parseVisitRequest,
  marcarHorarioOcupado,
  buildVisitRecord,
  formatSchedulingReply,
  cierreDelDia,
  formatearFechaLegible,
  formatearHoraLegible,
  HORA_APERTURA,
  HORA_CIERRE,
  SABADO_CIERRE,
};
