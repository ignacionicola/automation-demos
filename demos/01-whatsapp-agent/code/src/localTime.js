/**
 * La hora de pared de Córdoba, sin importar dónde corra n8n.
 *
 * Por qué existe: los Code nodes heredan la zona horaria del proceso, que en
 * el contenedor de `deploy/` es UTC. Mientras la agenda era un mock daba igual;
 * con Google Calendar del otro lado deja de darlo, porque "mañana a las 10" se
 * grabaría tres horas corrido en la agenda del dueño y "hoy" cambiaría de día
 * a las 21:00 argentinas, justo cuando el cliente escribe "mañana".
 *
 * Argentina no aplica horario de verano desde 2009, así que el offset es fijo
 * y alcanza con aritmética. Es lo que hay: dentro de un Code node no se puede
 * importar una librería de zonas horarias.
 *
 * Dos representaciones, y conviene no mezclarlas:
 *
 * - **hora de pared**: un Date cuyos componentes LOCALES (getHours, getDate…)
 *   son los de Córdoba. Sirve para las cuentas de calendario — qué día cae,
 *   si entra en el horario de atención — porque son las que ve el cliente.
 * - **instante**: epoch en milisegundos, que es lo único comparable contra las
 *   fechas que devuelve Google. `aInstante` convierte de la primera a la
 *   segunda.
 */

const ZONA_HORARIA = 'America/Argentina/Buenos_Aires';
const OFFSET_UTC = '-03:00';
const OFFSET_MINUTOS = -180;

function dosDigitos(valor) {
  return String(valor).padStart(2, '0');
}

function esFechaValida(fecha) {
  return fecha instanceof Date && !Number.isNaN(fecha.getTime());
}

/**
 * "Ahora" como hora de pared de Córdoba.
 *
 * @param {Date|string|number} [referencia] instante a convertir; por defecto, ahora
 * @returns {Date}
 */
function ahoraEnArgentina(referencia) {
  const base = referencia === undefined || referencia === null ? new Date() : new Date(referencia);
  if (!esFechaValida(base)) return new Date(NaN);

  // Se corre el instante y después se leen los componentes en UTC: así los
  // componentes locales del Date resultante son los de Córdoba.
  const corrido = new Date(base.getTime() + OFFSET_MINUTOS * 60000);
  return new Date(
    corrido.getUTCFullYear(),
    corrido.getUTCMonth(),
    corrido.getUTCDate(),
    corrido.getUTCHours(),
    corrido.getUTCMinutes(),
    corrido.getUTCSeconds(),
  );
}

/** YYYY-MM-DD de una hora de pared. */
function aFechaIso(fecha) {
  if (!esFechaValida(fecha)) return null;
  return `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}-${dosDigitos(fecha.getDate())}`;
}

/** HH:MM de una hora de pared. */
function aHoraIso(fecha) {
  if (!esFechaValida(fecha)) return null;
  return `${dosDigitos(fecha.getHours())}:${dosDigitos(fecha.getMinutes())}`;
}

/**
 * Hora de pared a RFC3339 con el offset argentino explícito
 * ("2026-08-06T16:00:00-03:00"), que es lo que Google Calendar entiende sin
 * ambigüedad. Mandar la fecha sin offset la dejaría a interpretación del
 * servidor, que es precisamente el problema que este módulo evita.
 */
function aRfc3339(fecha) {
  if (!esFechaValida(fecha)) return null;
  const dia = aFechaIso(fecha);
  const hora = `${aHoraIso(fecha)}:${dosDigitos(fecha.getSeconds())}`;
  return `${dia}T${hora}${OFFSET_UTC}`;
}

/**
 * De vuelta a hora de pared desde un RFC3339. Lee los componentes tal cual
 * están escritos y descarta el offset a propósito: el texto viene de
 * `aRfc3339`, así que ya está en hora de Córdoba, y dejar que `new Date()` lo
 * reinterprete lo volvería a correr a la zona del proceso.
 */
function deRfc3339(texto) {
  const partes = String(texto || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!partes) return new Date(NaN);
  return new Date(
    Number(partes[1]),
    Number(partes[2]) - 1,
    Number(partes[3]),
    Number(partes[4]),
    Number(partes[5]),
    Number(partes[6] || 0),
  );
}

/** Instante real (epoch ms) de una hora de pared argentina. */
function aInstante(fecha) {
  const texto = aRfc3339(fecha);
  return texto ? Date.parse(texto) : NaN;
}

/**
 * Suma minutos sobre el calendario local en vez de sobre el epoch. La
 * diferencia importa si el proceso corre en una zona con horario de verano:
 * sumando milisegundos, cruzar el cambio de hora corre la hora de pared.
 */
function sumarMinutos(fecha, minutos) {
  if (!esFechaValida(fecha)) return new Date(NaN);
  return new Date(
    fecha.getFullYear(),
    fecha.getMonth(),
    fecha.getDate(),
    fecha.getHours(),
    fecha.getMinutes() + Number(minutos || 0),
    fecha.getSeconds(),
  );
}

/** Hora de pared con la hora del día cambiada, mismo día. */
function conHora(fecha, horas, minutos) {
  if (!esFechaValida(fecha)) return new Date(NaN);
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate(), horas, minutos || 0, 0);
}

module.exports = {
  ZONA_HORARIA,
  OFFSET_UTC,
  OFFSET_MINUTOS,
  ahoraEnArgentina,
  aFechaIso,
  aHoraIso,
  aRfc3339,
  deRfc3339,
  aInstante,
  sumarMinutos,
  conHora,
  esFechaValida,
  dosDigitos,
};
