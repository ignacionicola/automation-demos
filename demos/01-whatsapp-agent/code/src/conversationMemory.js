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
  // Se acumula como cualquier otra entidad: el cliente dice el día en un
  // mensaje y el mail en el siguiente, y recién ahí hay con qué agendar.
  'email',
  'referencia_propiedad',
];

const CONVERSACION_VACIA = { mensajes: [], entidades: {}, mostradas: [], actualizadoEn: 0 };

// Cuántas propiedades mostradas se recuerdan. La búsqueda devuelve hasta 3, y
// guardar más haría que "el primero" apunte a una tanda vieja.
const MAX_MOSTRADAS = 3;

function esVacio(valor) {
  return valor === null || valor === undefined || valor === '';
}

// Los criterios de una búsqueda de propiedades. Acumularlos es lo que hace que
// "busco depto en Nueva Córdoba" + "de un dormitorio" funcione como un solo
// pedido; el problema es cuando el cliente cambia de tema y los arrastra.
//
// El caso que lo destapó: pidió "una casa más grande", después "algo de 8
// dormitorios", y el `tipo: casa` de dos mensajes antes descartó la única
// propiedad de 8 dormitorios del catálogo, que estaba cargada como
// departamento. El agente contestó que no tenía nada teniendo la coincidencia
// exacta.
// Entidades que valen solo para el mensaje en que aparecen y nunca se heredan.
const ENTIDADES_DEL_MOMENTO = ['busqueda_libre'];

const ENTIDADES_DE_BUSQUEDA = [
  'operacion',
  'tipo',
  'ciudad',
  'barrio',
  'dormitorios',
  'banios',
  'presupuesto',
  'moneda',
];

/**
 * Fusiona lo que el cliente ya había dicho con lo que dice ahora. Un valor
 * nuevo pisa al anterior (el cliente cambió de idea); un valor ausente deja
 * en pie el anterior (el cliente no lo repitió, pero sigue valiendo).
 *
 * @param {object} [opciones] `{ reiniciarBusqueda: true }` descarta los
 *        criterios anteriores en vez de arrastrarlos. Lo decide el
 *        clasificador, que es quien puede distinguir "y de un dormitorio"
 *        (refina) de "la casa de Messi tenés?" (empieza de nuevo).
 */
function combinarEntidades(previas, nuevas, opciones) {
  const anteriores = previas || {};
  const actuales = nuevas || {};
  const reiniciar = Boolean((opciones || {}).reiniciarBusqueda);
  const resultado = {};

  // Nombrar una propiedad vale para ese mensaje y nada más. Si se acumulara,
  // el cliente pregunta "la casa de Messi tenés?" y las tres búsquedas
  // siguientes seguirían filtrando por ese nombre.
  for (const clave of ENTIDADES_DEL_MOMENTO) {
    resultado[clave] = esVacio(actuales[clave]) ? null : actuales[clave];
  }

  for (const clave of ENTIDADES_ACUMULABLES) {
    const valorNuevo = actuales[clave];
    if (!esVacio(valorNuevo)) {
      resultado[clave] = valorNuevo;
      continue;
    }
    // Sin valor nuevo: se hereda el anterior, salvo que esto sea una búsqueda
    // nueva y la clave sea un criterio de búsqueda.
    const heredable = !(reiniciar && ENTIDADES_DE_BUSQUEDA.includes(clave));
    resultado[clave] = heredable ? anteriores[clave] ?? null : null;
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
    mostradas: Array.isArray(crudo.mostradas) ? crudo.mostradas.filter((p) => p && p.id) : [],
    actualizadoEn: Number(crudo.actualizadoEn) || 0,
  };
}

// Lo que deja de valer apenas la visita quedó agendada. El resto de las
// entidades (barrio, presupuesto, tipo) siguen describiendo lo que el cliente
// busca y no hay motivo para olvidarlas.
const ENTIDADES_DE_LA_VISITA = ['fecha_visita', 'hora_visita', 'referencia_propiedad'];

/**
 * Olvida los datos de una visita que ya se agendó.
 *
 * Sin esto quedan cargados y el próximo mensaje corto los vuelve a usar: un
 * "hola" clasificado como continuación encuentra fecha, hora y propiedad
 * listas y agenda una segunda visita que nadie pidió. Pasó de verdad.
 */
function olvidarVisita(conversacion) {
  const base = conversacion || CONVERSACION_VACIA;
  const entidades = { ...(base.entidades || {}) };

  for (const clave of ENTIDADES_DE_LA_VISITA) entidades[clave] = null;

  return { ...base, entidades };
}

/**
 * Deja anotado qué propiedades se le mostraron al cliente, para que en el
 * mensaje siguiente "el primero" o "el de Las Flores" quieran decir algo.
 *
 * Hace falta porque la memoria guarda lo que escribe el cliente, no lo que
 * contesta el bot: sin esto el modelo no tiene forma de saber qué había en la
 * lista que él mismo mandó.
 *
 * @param {object} conversacion
 * @param {Array} propiedades  las que se mostraron, en el orden en que se mostraron
 */
function recordarPropiedadesMostradas(conversacion, propiedades) {
  const base = conversacion || CONVERSACION_VACIA;
  const lista = (Array.isArray(propiedades) ? propiedades : [])
    .filter((p) => p && p.id)
    .slice(0, MAX_MOSTRADAS)
    .map((p) => ({ id: p.id, barrio: p.barrio || '', ciudad: p.ciudad || '' }));

  // Una búsqueda sin resultados no borra la tanda anterior: el cliente puede
  // seguir refiriéndose a lo último que sí vio.
  if (lista.length === 0) return { ...base };

  return { ...base, mostradas: lista };
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

  // Igual que en fusionarEntidades: el spread evita que este return se coma
  // los campos del estado que no enumera acá.
  return {
    ...base,
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
function fusionarEntidades(conversacion, entidades, ahora, opciones) {
  const base = conversacion || CONVERSACION_VACIA;

  // El spread no es cosmético: sin él este return arma un objeto nuevo con
  // solo tres campos y se come el resto del estado en cada mensaje. Ya pasó
  // con las propiedades mostradas, que se perdían en cuanto el cliente decía
  // cualquier otra cosa.
  return {
    ...base,
    mensajes: Array.isArray(base.mensajes) ? base.mensajes : [],
    entidades: combinarEntidades(base.entidades, entidades, opciones),
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

  // Sin esto, "el primero" o "el de Las Flores" no tienen contra qué
  // resolverse: el modelo no ve sus propias respuestas.
  const mostradas = Array.isArray(conversacion.mostradas) ? conversacion.mostradas : [];
  if (mostradas.length) {
    if (partes.length) partes.push('');
    partes.push('Propiedades que ya le mostraste, en este orden:');
    mostradas.forEach((propiedad, indice) => {
      const donde = [propiedad.barrio, propiedad.ciudad].filter(Boolean).join(', ');
      partes.push(`${indice + 1}. ${propiedad.id}${donde ? ` — ${donde}` : ''}`);
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
  olvidarVisita,
  recordarPropiedadesMostradas,
  ENTIDADES_DE_LA_VISITA,
  ENTIDADES_DE_BUSQUEDA,
  ENTIDADES_DEL_MOMENTO,
  reemplazarUltimoMensaje,
  fusionarEntidades,
  formatearContexto,
  TTL_INACTIVIDAD_MS,
  MAX_MENSAJES,
  ENTIDADES_ACUMULABLES,
};
