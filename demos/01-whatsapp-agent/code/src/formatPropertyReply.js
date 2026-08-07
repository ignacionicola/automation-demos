/**
 * Arma el texto que recibe el cliente por WhatsApp con las propiedades que
 * matchearon. Español rioplatense, con el formato de negrita de WhatsApp (*).
 */

const ETIQUETAS_TIPO = {
  departamento: 'Departamento',
  casa: 'Casa',
  ph: 'PH',
  local: 'Local',
};

// Para nombrar lo que se buscó en plural, sin inventar reglas de pluralización.
const TIPOS_EN_PLURAL = {
  departamento: 'departamentos',
  casa: 'casas',
  ph: 'PH',
  local: 'locales',
};

function formatearMonto(precio, moneda) {
  const numero = new Intl.NumberFormat('es-AR').format(precio);
  return moneda === 'USD' ? `USD ${numero}` : `$${numero}`;
}

function formatearPrecio(propiedad) {
  const monto = formatearMonto(propiedad.precio, propiedad.moneda);
  if (propiedad.operacion !== 'alquiler') return monto;

  const expensas = propiedad.expensas
    ? ` + ${formatearMonto(propiedad.expensas, 'ARS')} de expensas`
    : ' (sin expensas)';
  return `${monto} por mes${expensas}`;
}

function formatearCaracteristicas(propiedad) {
  const partes = [`${propiedad.superficie_m2} m²`];

  if (propiedad.dormitorios > 0) {
    partes.push(`${propiedad.dormitorios} ${propiedad.dormitorios === 1 ? 'dormitorio' : 'dormitorios'}`);
  }
  partes.push(`${propiedad.banios} ${propiedad.banios === 1 ? 'baño' : 'baños'}`);
  partes.push(propiedad.cochera ? 'con cochera' : 'sin cochera');

  return partes.join(' · ');
}

/**
 * Describe en una frase lo que efectivamente se buscó.
 *
 * Existe porque la búsqueda arrastra criterios de mensajes anteriores: si el
 * cliente pregunta "¿tenés en Alberdi?" y venía de pedir 2 dormitorios, el
 * filtro sigue puesto. Sin decirlo, un "en ese barrio no tengo nada" parece
 * lisa y llanamente falso cuando sí hay algo en Alberdi (de 1 dormitorio).
 * Nombrando los criterios, el cliente ve qué se buscó y puede corregirlo.
 *
 * @returns {string} '' si no hay ningún criterio que valga la pena nombrar
 */
function describirCriterios(criterios) {
  const filtros = criterios || {};
  const partes = [];

  if (filtros.operacion === 'venta') partes.push('en venta');
  else if (filtros.operacion === 'alquiler') partes.push('en alquiler');

  if (typeof filtros.dormitorios === 'number') {
    partes.unshift(`de ${filtros.dormitorios} ${filtros.dormitorios === 1 ? 'dormitorio' : 'dormitorios'}`);
  }
  if (typeof filtros.banios === 'number') {
    partes.push(`con ${filtros.banios} ${filtros.banios === 1 ? 'baño' : 'baños'}`);
  }

  const sustantivo = TIPOS_EN_PLURAL[filtros.tipo] || 'propiedades';
  // Sin ningún filtro, "propiedades" solo no aporta nada.
  if (partes.length === 0 && !filtros.tipo) return '';

  return [sustantivo, ...partes].join(' ');
}

/**
 * El barrio llega tal cual lo escribió el cliente ("alberdi", "nueva cordoba"),
 * porque así se lo pide el prompt. Para el mensaje se capitaliza cada palabra,
 * que es como lo escribiría una persona.
 */
function capitalizarBarrio(valor) {
  if (typeof valor !== 'string' || !valor.trim()) return '';
  return valor
    .trim()
    .split(/\s+/)
    .map((palabra) => palabra.charAt(0).toUpperCase() + palabra.slice(1))
    .join(' ');
}

function encabezado(nivel, cantidad, criterios) {
  const unica = cantidad === 1;
  const sujeto = unica ? 'esta opción' : `estas ${cantidad} opciones`;
  const buscado = describirCriterios(criterios);
  const barrio = capitalizarBarrio(criterios && criterios.barrio);
  const ciudad = capitalizarBarrio(criterios && criterios.ciudad);
  // "en Las Flores, Río Tercero" cuando hay ambos; si no, el que haya.
  const donde = [barrio, ciudad].filter(Boolean).join(', ');

  if (nivel === 'sin_barrio') {
    const acercan = unica ? 'se acerca' : 'se acercan';
    // Se nombra lo buscado para que se entienda por qué no hubo match: puede
    // ser por el barrio, pero también por un filtro que venía de antes.
    const queBusque = buscado && donde ? `${buscado} en ${donde}` : buscado || `nada en ${donde || 'ese barrio'}`;
    return `No encontré ${queBusque}, pero fijate ${sujeto} que ${acercan} bastante 👇`;
  }
  if (nivel === 'presupuesto_ampliado') {
    const valen = unica ? 'vale' : 'valen';
    return `Justo en ese presupuesto no me quedó nada, pero te muestro ${sujeto} un poco por encima que ${valen} la pena 👇`;
  }
  const encajan = unica ? 'encaja' : 'encajan';
  return `¡Buenísimo! Encontré ${sujeto} que ${encajan} con lo que buscás 👇`;
}

function bloqueDePropiedad(propiedad, indice) {
  const tipo = ETIQUETAS_TIPO[propiedad.tipo] || propiedad.tipo;
  const operacion = propiedad.operacion === 'alquiler' ? 'Alquiler' : 'Venta';
  const lineas = [
    `*${indice + 1}. ${propiedad.titulo}*`,
    // La ciudad se nombra siempre: el catálogo tiene más de una localidad y
    // "Las Flores" sin ciudad no le dice nada a alguien de otra zona. Peor
    // todavía con "Alberdi", que es barrio de Córdoba capital *y* de Río
    // Tercero.
    `📍 ${propiedad.barrio}${propiedad.ciudad ? `, ${propiedad.ciudad}` : ''} · ${tipo} en ${operacion.toLowerCase()}`,
    `💰 ${formatearPrecio(propiedad)}`,
    `📐 ${formatearCaracteristicas(propiedad)}`,
  ];

  if (Array.isArray(propiedad.destacados) && propiedad.destacados.length > 0) {
    lineas.push(`✨ ${propiedad.destacados.join(' · ')}`);
  }
  // Opcional: no todas las fichas del catálogo la tienen cargada.
  if (propiedad.direccion) {
    lineas.push(`🗺️ ${propiedad.direccion}`);
  }
  lineas.push(`Ref: ${propiedad.id}`);

  return lineas.join('\n');
}

/**
 * @param {{resultados: Array, nivel: string, total: number}} match salida de matchProperties
 * @param {{agencia?: string, criterios?: object}} contexto
 * @returns {string} mensaje listo para enviar por WhatsApp
 */
function formatPropertyReply(match, contexto) {
  const agencia = (contexto && contexto.agencia) || 'la inmobiliaria';
  const criterios = contexto && contexto.criterios;
  const resultados = (match && match.resultados) || [];

  if (resultados.length === 0) {
    // No es lo mismo "no tengo nada así" que "ya te mostré todo lo que tengo
    // así". Con la segunda, el cliente que pidió ver más opciones merece
    // saber que las vio todas, no que su búsqueda no dio resultados.
    if (match && match.agotadas) {
      const cuantas = match.totalSinExcluir;
      return [
        `Esas son todas las que tengo con esas características${cuantas ? ` (${cuantas} en total)` : ''} 🙈`,
        '',
        '¿Ampliamos la búsqueda —otro barrio, otro rango de precio— o te paso con un asesor?',
      ].join('\n');
    }

    const ciudad = capitalizarBarrio(criterios && criterios.ciudad);
    // La ciudad nunca se relaja, así que si no hubo nada y el cliente nombró
    // una, lo más probable es que sea eso — conviene decirlo en vez de dejarlo
    // en un "no encontré nada" genérico que suena a que no se buscó bien.
    const donde = ciudad ? ` en ${ciudad}` : '';
    const alternativa = ciudad
      ? '¿Querés que busque en otra localidad, o te paso con un asesor para que te avise si entra algo?'
      : '¿Querés que lo intentemos con otro barrio o ampliando un poco el presupuesto? Si preferís, le paso tu consulta a un asesor para que te busque algo a medida.';

    return [
      `Uf, no encontré nada que encaje con eso${donde} en el catálogo de ${agencia} 😕`,
      '',
      alternativa,
    ].join('\n');
  }

  const bloques = resultados.map(bloqueDePropiedad).join('\n\n');
  const cierre =
    match.total > resultados.length
      ? `Tengo ${match.total} propiedades que entran en esa búsqueda, te muestro las ${resultados.length} más afines.`
      : '';
  const pregunta = resultados.length === 1 ? '¿Te interesa?' : '¿Te interesa alguna?';

  return [
    encabezado(match.nivel, resultados.length, contexto && contexto.criterios),
    '',
    bloques,
    '',
    cierre,
    `${pregunta} Decime la referencia y qué día te queda cómodo, y coordinamos la visita. 🏠`,
  ]
    .filter((parte, indice, todas) => !(parte === '' && todas[indice - 1] === ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Tope del pie de foto de WhatsApp. Una ficha entra cómoda, pero se corta por
// las dudas: pasarse hace fallar el envío entero, y perder una línea del
// listado es mejor que perder el mensaje.
const LARGO_MAXIMO_CAPTION = 1024;

function recortar(texto, maximo) {
  return texto.length <= maximo ? texto : `${texto.slice(0, maximo - 1)}…`;
}

/**
 * Arma la respuesta cuando se van a mandar fotos: un mensaje de texto corto y
 * una foto por propiedad, con la ficha como pie de foto.
 *
 * Por qué separado de formatPropertyReply: con fotos, repetir las fichas en el
 * texto duplicaría todo. Acá el texto queda como encabezado y cada ficha viaja
 * en el pie de su propia foto — que es como manda las cosas una inmobiliaria
 * de verdad, y se ve mucho mejor en el chat.
 *
 * Las propiedades que no tengan foto cargada no se pierden: sus fichas se
 * agregan al mensaje de texto.
 *
 * @returns {{texto: string, fotos: Array<{link: string, caption: string}>}}
 */
function buildPhotoReply(match, contexto) {
  const resultados = (match && match.resultados) || [];

  // Sin resultados no hay nada que ilustrar: vale el mensaje de siempre.
  if (resultados.length === 0) {
    return { texto: formatPropertyReply(match, contexto), fotos: [] };
  }

  const conFoto = [];
  const sinFoto = [];
  resultados.forEach((propiedad, indice) => {
    (propiedad.foto ? conFoto : sinFoto).push({ propiedad, indice });
  });

  // Si ninguna tiene foto, no tiene sentido el formato partido.
  if (conFoto.length === 0) {
    return { texto: formatPropertyReply(match, contexto), fotos: [] };
  }

  const cierre =
    match.total > resultados.length
      ? `Tengo ${match.total} propiedades que entran en esa búsqueda, te muestro las ${resultados.length} más afines.`
      : '';
  const pregunta = resultados.length === 1 ? '¿Te interesa?' : '¿Te interesa alguna?';

  const texto = [
    encabezado(match.nivel, resultados.length, contexto && contexto.criterios),
    '',
    // Las que no tienen foto van completas acá, para no dejarlas afuera.
    sinFoto.map(({ propiedad, indice }) => bloqueDePropiedad(propiedad, indice)).join('\n\n'),
    '',
    cierre,
    `${pregunta} Decime la referencia y qué día te queda cómodo, y coordinamos la visita. 🏠`,
  ]
    .filter((parte, indice, todas) => !(parte === '' && todas[indice - 1] === ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const fotos = conFoto.map(({ propiedad, indice }) => ({
    link: propiedad.foto,
    caption: recortar(bloqueDePropiedad(propiedad, indice), LARGO_MAXIMO_CAPTION),
  }));

  return { texto, fotos };
}

module.exports = {
  formatPropertyReply,
  buildPhotoReply,
  formatearMonto,
  formatearPrecio,
  formatearCaracteristicas,
  describirCriterios,
  LARGO_MAXIMO_CAPTION,
};
