/**
 * De dónde sale la configuración: la planilla del cliente, con el repo como
 * respaldo.
 *
 * Dos decisiones que vale la pena explicar.
 *
 * **Caché.** Pegarle a Sheets en cada mensaje son tres llamadas más por cada
 * "hola". El catálogo de una inmobiliaria cambia unas pocas veces por semana,
 * así que se guarda en memoria del workflow por un rato. La carrera existe —dos
 * ejecuciones simultáneas pueden refrescar las dos— pero acá el peor caso es
 * una lectura de más, no un dato perdido: es caché, no estado.
 *
 * **Respaldo.** Si Sheets no contesta, se usa el JSON del repo y queda
 * anotado. La alternativa sería contestar "no tengo propiedades", que le miente
 * al cliente sobre el catálogo de la inmobiliaria por un problema de
 * infraestructura. Un catálogo viejo es mejor que ninguno.
 */

const { parsearCatalogo } = require('./sheetCatalog');
const { parsearNegocio, parsearFaq, NEGOCIO_POR_DEFECTO } = require('./businessConfig');

// Cuánto vale la pena reusar lo leído. Cinco minutos deja al cliente ver sus
// cambios enseguida sin convertir cada mensaje en tres llamadas a la API.
const CACHE_MS = 5 * 60 * 1000;

const ORIGEN_PLANILLA = 'planilla';
const ORIGEN_RESPALDO = 'respaldo_local';

function estaVigenteElCache(cache, ahora, ttlMs) {
  if (!cache || !cache.guardadoEn) return false;
  return ahora - cache.guardadoEn <= (ttlMs || CACHE_MS);
}

/**
 * Arma la configuración desde lo que devolvió Sheets, cayendo al respaldo
 * cuando la planilla no trajo nada usable.
 *
 * Ojo con la diferencia entre "Sheets falló" y "Sheets contestó una pestaña
 * vacía": las dos terminan en el respaldo, porque un catálogo vacío no es una
 * respuesta válida para un cliente que pregunta qué hay en alquiler. Pero solo
 * la primera es un error, y el motivo lo dice.
 *
 * @param {object} leido    { propiedades, negocio, faq } filas crudas de Sheets
 * @param {object} respaldo { propiedades, faq } lo que vive en el repo
 */
function construirConfig(leido, respaldo) {
  const crudo = leido || {};
  const local = respaldo || {};

  const { propiedades, descartadas } = parsearCatalogo(crudo.propiedades);
  const faq = parsearFaq(crudo.faq);

  const hayPropiedades = propiedades.length > 0;
  const hayFaq = faq.length > 0;

  return {
    propiedades: hayPropiedades ? propiedades : local.propiedades || [],
    negocio: parsearNegocio(crudo.negocio),
    faq: hayFaq ? faq : local.faq || [],
    origen: {
      propiedades: hayPropiedades ? ORIGEN_PLANILLA : ORIGEN_RESPALDO,
      faq: hayFaq ? ORIGEN_PLANILLA : ORIGEN_RESPALDO,
      // El negocio nunca cae al respaldo: parsearNegocio ya completa con sus
      // defaults campo por campo, así que una planilla a medio llenar sigue
      // aportando lo que sí tenga.
      negocio: Array.isArray(crudo.negocio) && crudo.negocio.length ? ORIGEN_PLANILLA : ORIGEN_RESPALDO,
      filasDescartadas: descartadas,
    },
  };
}

/** La config del repo, para cuando no hay planilla configurada ni respuesta. */
function configDeRespaldo(respaldo) {
  const local = respaldo || {};
  return {
    propiedades: local.propiedades || [],
    negocio: { ...NEGOCIO_POR_DEFECTO },
    faq: local.faq || [],
    origen: {
      propiedades: ORIGEN_RESPALDO,
      faq: ORIGEN_RESPALDO,
      negocio: ORIGEN_RESPALDO,
      filasDescartadas: 0,
    },
  };
}

/** Una línea para el log de la ejecución: de dónde salió cada cosa. */
function describirOrigen(config) {
  const origen = (config && config.origen) || {};
  const partes = [
    `propiedades: ${origen.propiedades || '?'} (${(config.propiedades || []).length})`,
    `faq: ${origen.faq || '?'} (${(config.faq || []).length})`,
    `negocio: ${origen.negocio || '?'}`,
  ];
  if (origen.filasDescartadas) partes.push(`${origen.filasDescartadas} filas sin código`);
  return partes.join(' · ');
}

module.exports = {
  CACHE_MS,
  ORIGEN_PLANILLA,
  ORIGEN_RESPALDO,
  estaVigenteElCache,
  construirConfig,
  configDeRespaldo,
  describirOrigen,
};
