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

function encabezado(nivel, cantidad) {
  const unica = cantidad === 1;
  const sujeto = unica ? 'esta opción' : `estas ${cantidad} opciones`;

  if (nivel === 'sin_barrio') {
    const acercan = unica ? 'se acerca' : 'se acercan';
    return `En ese barrio no tengo nada disponible en este momento, pero fijate ${sujeto} que ${acercan} bastante 👇`;
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
    `📍 ${propiedad.barrio} · ${tipo} en ${operacion.toLowerCase()}`,
    `💰 ${formatearPrecio(propiedad)}`,
    `📐 ${formatearCaracteristicas(propiedad)}`,
  ];

  if (Array.isArray(propiedad.destacados) && propiedad.destacados.length > 0) {
    lineas.push(`✨ ${propiedad.destacados.join(' · ')}`);
  }
  lineas.push(`Ref: ${propiedad.id}`);

  return lineas.join('\n');
}

/**
 * @param {{resultados: Array, nivel: string, total: number}} match salida de matchProperties
 * @param {{agencia?: string}} contexto
 * @returns {string} mensaje listo para enviar por WhatsApp
 */
function formatPropertyReply(match, contexto) {
  const agencia = (contexto && contexto.agencia) || 'la inmobiliaria';
  const resultados = (match && match.resultados) || [];

  if (resultados.length === 0) {
    return [
      `Uf, no encontré nada que encaje con eso en el catálogo de ${agencia} 😕`,
      '',
      '¿Querés que lo intentemos con otro barrio o ampliando un poco el presupuesto? Si preferís, le paso tu consulta a un asesor para que te busque algo a medida.',
    ].join('\n');
  }

  const bloques = resultados.map(bloqueDePropiedad).join('\n\n');
  const cierre =
    match.total > resultados.length
      ? `Tengo ${match.total} propiedades que entran en esa búsqueda, te muestro las ${resultados.length} más afines.`
      : '';
  const pregunta = resultados.length === 1 ? '¿Te interesa?' : '¿Te interesa alguna?';

  return [
    encabezado(match.nivel, resultados.length),
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

module.exports = { formatPropertyReply, formatearMonto, formatearPrecio, formatearCaracteristicas };
