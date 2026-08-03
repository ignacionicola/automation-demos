/**
 * Memoria de conversación por número de teléfono.
 *
 * Por qué existe: sin esto cada mensaje se clasifica aislado, y una conversación
 * real de WhatsApp no funciona así. "Busco depto en Nueva Córdoba" seguido de
 * "algo de un dormitorio" son un solo pedido partido en dos: el segundo mensaje
 * no menciona el barrio ni la operación, así que sin contexto el clasificador
 * devuelve entidades casi vacías y la búsqueda arranca de cero.
 *
 * Resuelve dos cosas distintas:
 *
 * 1. **Referencias.** El historial va dentro del prompt para que el modelo
 *    pueda interpretar "ese", "el primero" o "algo más barato".
 * 2. **Acumulación de entidades.** Lo que el cliente ya dijo se fusiona con lo
 *    que dice ahora, así la búsqueda usa el pedido completo y no solo el
 *    último fragmento.
 *
 * Dónde se guarda: en una Data Table de n8n, una fila por teléfono, con el
 * estado serializado como JSON en una columna. Se probó primero con
 * `$getWorkflowStaticData` y **no sirve para esto**: n8n carga la static data
 * al empezar la ejecución y la guarda al terminar, sin bloqueos. Dos mensajes
 * seguidos se solapan (la clasificación tarda varios segundos), las dos
 * ejecuciones parten del mismo snapshot y la última en terminar pisa a la
 * otra — medido en esta demo, con el primer mensaje desapareciendo del
 * historial. La Data Table escribe cuando corre el nodo, no al final, así que
 * el mensaje entrante queda registrado antes de la llamada al LLM.
 *
 * Las funciones son puras: reciben y devuelven objetos, sin tocar n8n. El
 * workflow se encarga de leer y escribir la fila.
 */

// Cuánta inactividad hace que una conversación se considere terminada. Media
// hora es suficiente para un ida y vuelta de WhatsApp sin arrastrar el
// contexto de una consulta de ayer a una nueva de hoy.
const TTL_INACTIVIDAD_MS = 30 * 60 * 1000;

// Cuántos mensajes del cliente se recuerdan. Alcanza para resolver referencias
// sin inflar el prompt (y por lo tanto el costo) de cada clasificación.
const MAX_MENSAJES = 6;

// Las entidades que tiene sentido arrastrar entre mensajes. Se listan explícito
// en vez de fusionar todo lo que venga, para que una clave nueva inventada por
// el modelo no se cuele en la memoria.
const ENTIDADES_ACUMULABLES = [
  'operacion',
  'tipo',
  'ciudad',
  'barrio',
  'dormitorios',
  'banios',
  'presupuesto',
  'moneda',
  'fecha_visita',
  'hora_visita',
  'referencia_propiedad',
];

const CONVERSACION_VACIA = { mensajes: [], entidades: {}, actualizadoEn: 0 };

function esVacio(valor) {
  return valor === null || valor === undefined || valor === '';
}

/**
 * Fusiona lo que el cliente ya había dicho con lo que dice ahora. Un valor
 * nuevo pisa al anterior (el cliente cambió de idea); un valor ausente deja
 * en pie el anterior (el cliente no lo repitió, pero sigue valiendo).
 */
function combinarEntidades(previas, nuevas) {
  const anteriores = previas || {};
  const actuales = nuevas || {};
  const resultado = {};

  for (const clave of ENTIDADES_ACUMULABLES) {
    const valorNuevo = actuales[clave];
    resultado[clave] = esVacio(valorNuevo) ? anteriores[clave] ?? null : valorNuevo;
  }

  return resultado;
}

/**
 * Interpreta lo que vino de la Data Table. Tolera que la columna llegue como
 * string JSON, como objeto ya parseado, vacía o con basura: ante cualquier
 * duda devuelve una conversación vacía en vez de romper el flujo.
 */
function parseEstado(valor) {
  let crudo = valor;

  if (typeof crudo === 'string') {
    try {
      crudo = JSON.parse(crudo);
    } catch (error) {
      return { ...CONVERSACION_VACIA };
    }
  }

  if (!crudo || typeof crudo !== 'object') return { ...CONVERSACION_VACIA };

  return {
    mensajes: Array.isArray(crudo.mensajes) ? crudo.mensajes.filter((m) => m && m.texto) : [],
    entidades: crudo.entidades && typeof crudo.entidades === 'object' ? crudo.entidades : {},
    actualizadoEn: Number(crudo.actualizadoEn) || 0,
  };
}

function serializarEstado(conversacion) {
  return JSON.stringify(conversacion || CONVERSACION_VACIA);
}

/**
 * Una conversación sigue viva si el último mensaje entró dentro del TTL. La
 * fila vieja puede seguir en la tabla: se ignora y se pisa en la próxima
 * escritura.
 */
function estaVigente(conversacion, ahora, opciones) {
  const ttl = (opciones || {}).ttlMs || TTL_INACTIVIDAD_MS;
  if (!conversacion || !conversacion.actualizadoEn) return false;
  return ahora - conversacion.actualizadoEn <= ttl;
}

/**
 * Lo que usa el workflow al leer la fila: parsea y descarta lo vencido.
 *
 * @returns {{mensajes: Array, entidades: object, actualizadoEn: number}} vacía
 *          si no había fila o si la conversación ya venció
 */
function conversacionActiva(valorDeLaFila, ahora, opciones) {
  const conversacion = parseEstado(valorDeLaFila);
  return estaVigente(conversacion, ahora, opciones) ? conversacion : { ...CONVERSACION_VACIA };
}

/**
 * Suma el mensaje entrante al historial. Se llama antes de clasificar, así la
 * ejecución del mensaje siguiente ya lo encuentra escrito.
 */
function agregarMensaje(conversacion, turno, ahora, opciones) {
  const maxMensajes = (opciones || {}).maxMensajes || MAX_MENSAJES;
  const base = conversacion || CONVERSACION_VACIA;
  const datos = turno || {};

  const mensajes = Array.isArray(base.mensajes) ? base.mensajes.slice() : [];
  const texto = String(datos.mensaje || '').trim();
  if (texto) {
    mensajes.push({ texto, intent: datos.intent || null, en: ahora });
  }

  return {
    mensajes: mensajes.slice(-maxMensajes),
    entidades: base.entidades || {},
    actualizadoEn: ahora,
  };
}

/**
 * Cambia el texto del último mensaje del historial.
 *
 * Existe por las notas de voz: el mensaje entrante se guarda antes de llamar al
 * LLM (para que un mensaje simultáneo lo encuentre), pero en ese momento el
 * audio todavía no está transcripto y se guarda un marcador. Cuando vuelve la
 * transcripción, se reemplaza — así el historial que ve el modelo en el
 * próximo turno tiene lo que la persona dijo, no "(nota de voz)".
 */
function reemplazarUltimoMensaje(conversacion, texto) {
  const base = conversacion || CONVERSACION_VACIA;
  const mensajes = Array.isArray(base.mensajes) ? base.mensajes.slice() : [];
  const nuevo = String(texto || '').trim();

  if (!nuevo || mensajes.length === 0) return { ...base, mensajes };

  mensajes[mensajes.length - 1] = { ...mensajes[mensajes.length - 1], texto: nuevo };
  return { ...base, mensajes };
}

/**
 * Fusiona las entidades que extrajo el clasificador. Se llama después de
 * clasificar, con la conversación ya actualizada por agregarMensaje.
 */
function fusionarEntidades(conversacion, entidades, ahora) {
  const base = conversacion || CONVERSACION_VACIA;

  return {
    mensajes: Array.isArray(base.mensajes) ? base.mensajes : [],
    entidades: combinarEntidades(base.entidades, entidades),
    actualizadoEn: ahora || base.actualizadoEn,
  };
}

/**
 * Arma el bloque de contexto que se le manda al modelo. Devuelve '' cuando no
 * hay nada que contar, para no ensuciar el prompt del primer mensaje.
 *
 * @param {object} conversacion estado ya filtrado por vigencia
 * @param {string} mensajeActual se excluye del historial: ya va aparte en el
 *        prompt, y para cuando se arma el contexto puede estar registrado
 */
function formatearContexto(conversacion, mensajeActual) {
  if (!conversacion) return '';

  const partes = [];
  const todos = Array.isArray(conversacion.mensajes) ? conversacion.mensajes : [];
  const actual = String(mensajeActual || '').trim();

  // El mensaje actual puede estar o no en el historial según cuándo se llame;
  // se saca solo la última aparición para no repetirlo en el prompt.
  const mensajes = todos.slice();
  if (actual) {
    for (let i = mensajes.length - 1; i >= 0; i -= 1) {
      if (mensajes[i].texto === actual) {
        mensajes.splice(i, 1);
        break;
      }
    }
  }

  if (mensajes.length) {
    partes.push('Mensajes anteriores de este cliente (del más viejo al más nuevo):');
    mensajes.forEach((mensaje, indice) => {
      partes.push(`${indice + 1}. "${mensaje.texto}"`);
    });
  }

  const entidades = conversacion.entidades || {};
  const yaDichas = ENTIDADES_ACUMULABLES.filter((clave) => !esVacio(entidades[clave]));

  if (yaDichas.length) {
    if (partes.length) partes.push('');
    partes.push('Datos que este cliente ya dio en mensajes anteriores:');
    yaDichas.forEach((clave) => {
      partes.push(`- ${clave}: ${entidades[clave]}`);
    });
  }

  return partes.join('\n');
}

module.exports = {
  combinarEntidades,
  parseEstado,
  serializarEstado,
  estaVigente,
  conversacionActiva,
  agregarMensaje,
  reemplazarUltimoMensaje,
  fusionarEntidades,
  formatearContexto,
  TTL_INACTIVIDAD_MS,
  MAX_MENSAJES,
  ENTIDADES_ACUMULABLES,
};
