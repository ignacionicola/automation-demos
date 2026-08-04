/**
 * El catálogo de propiedades, leído de la planilla del cliente.
 *
 * El objetivo del formato es que una inmobiliaria pueda mantenerlo sin
 * explicaciones: una fila por propiedad, encabezados en castellano, y ninguna
 * columna obligatoria salvo el código. Una fila incompleta entra igual y
 * simplemente participa de menos búsquedas; lo único que la deja afuera es no
 * tener con qué nombrarla.
 *
 * A propósito NO valida en el sentido de rechazar: el costo de descartar una
 * propiedad real por un dato mal escrito es que el cliente no la ve, y eso es
 * peor que mostrarla sin metros cuadrados.
 */

const { celdaTexto, celdaNumero, celdaEntero, celdaBooleano, celdaLista, celdaUrl } = require('./sheetValues');

// Los encabezados que se esperan en la pestaña "propiedades". Se aceptan
// variantes porque nadie escribe "superficie_m2" a mano dos veces igual.
const COLUMNAS = {
  id: ['id', 'codigo', 'código', 'ref', 'referencia'],
  titulo: ['titulo', 'título', 'nombre'],
  operacion: ['operacion', 'operación'],
  tipo: ['tipo'],
  ciudad: ['ciudad', 'localidad'],
  barrio: ['barrio', 'zona'],
  direccion: ['direccion', 'dirección'],
  dormitorios: ['dormitorios', 'dorm', 'ambientes'],
  banios: ['banios', 'baños', 'banos'],
  superficie_m2: ['superficie_m2', 'superficie', 'm2', 'metros'],
  cochera: ['cochera', 'garage', 'garaje'],
  precio: ['precio', 'valor'],
  moneda: ['moneda'],
  expensas: ['expensas'],
  descripcion: ['descripcion', 'descripción'],
  destacados: ['destacados', 'caracteristicas', 'características'],
  foto: ['foto', 'imagen', 'url_imagen', 'url de la imagen', 'url'],
};

const OPERACIONES = ['alquiler', 'venta'];
const TIPOS = ['departamento', 'casa', 'ph', 'local'];

function sinTildes(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Encuentra el valor de una columna en la fila, probando los alias. El nodo de
 * Sheets devuelve las filas con los encabezados como claves, así que acá se
 * compara contra lo que el cliente haya escrito arriba de todo.
 */
function valorDe(fila, alias) {
  const claves = Object.keys(fila || {});

  for (const nombre of alias) {
    const clave = claves.find((k) => sinTildes(k) === sinTildes(nombre));
    if (clave !== undefined) return fila[clave];
  }
  return undefined;
}

/**
 * Encaja el texto contra una lista conocida. Se compara sin tildes y por
 * prefijo, así "Alquiler", "alquileres" y "ALQUILER " son lo mismo. Si no
 * encaja con ninguno se devuelve null: un valor inventado haría que la
 * propiedad no aparezca en ninguna búsqueda, lo cual es peor que no filtrar.
 */
function encajarEn(valor, opciones) {
  const texto = sinTildes(valor);
  if (!texto) return null;
  return opciones.find((opcion) => texto.startsWith(opcion) || opcion.startsWith(texto)) || null;
}

function normalizarMoneda(valor) {
  const texto = sinTildes(valor).replace(/[^a-z$]/g, '');
  if (!texto) return null;
  if (texto.includes('usd') || texto.includes('dolar') || texto === 'u$s') return 'USD';
  return 'ARS';
}

/**
 * Una fila de la planilla a una propiedad del catálogo. Devuelve null si la
 * fila no sirve para nada — sin código no hay forma de que el cliente la pida
 * ni de que el evento de Calendar la nombre.
 */
function parsearPropiedad(fila) {
  const id = celdaTexto(valorDe(fila, COLUMNAS.id)).toUpperCase();
  if (!id) return null;

  const precio = celdaNumero(valorDe(fila, COLUMNAS.precio));

  return {
    id,
    titulo: celdaTexto(valorDe(fila, COLUMNAS.titulo)) || `Propiedad ${id}`,
    operacion: encajarEn(valorDe(fila, COLUMNAS.operacion), OPERACIONES),
    tipo: encajarEn(valorDe(fila, COLUMNAS.tipo), TIPOS),
    ciudad: celdaTexto(valorDe(fila, COLUMNAS.ciudad)) || null,
    barrio: celdaTexto(valorDe(fila, COLUMNAS.barrio)) || null,
    direccion: celdaTexto(valorDe(fila, COLUMNAS.direccion)) || null,
    dormitorios: celdaEntero(valorDe(fila, COLUMNAS.dormitorios)),
    banios: celdaEntero(valorDe(fila, COLUMNAS.banios)),
    superficie_m2: celdaEntero(valorDe(fila, COLUMNAS.superficie_m2)),
    cochera: celdaBooleano(valorDe(fila, COLUMNAS.cochera)),
    precio,
    // Sin precio la moneda no significa nada, y con precio hay que asumir algo:
    // en Córdoba, pesos.
    moneda: precio === null ? null : normalizarMoneda(valorDe(fila, COLUMNAS.moneda)) || 'ARS',
    expensas: celdaNumero(valorDe(fila, COLUMNAS.expensas)),
    descripcion: celdaTexto(valorDe(fila, COLUMNAS.descripcion)) || '',
    destacados: celdaLista(valorDe(fila, COLUMNAS.destacados)),
    foto: celdaUrl(valorDe(fila, COLUMNAS.foto)),
  };
}

/**
 * Todas las filas de la pestaña "propiedades".
 *
 * @returns {{propiedades: Array, descartadas: number}} `descartadas` cuenta las
 *          filas sin código, para poder avisarlo en el log sin frenar nada.
 */
function parsearCatalogo(filas) {
  const lista = Array.isArray(filas) ? filas : [];
  const propiedades = [];
  let descartadas = 0;

  for (const fila of lista) {
    const propiedad = parsearPropiedad(fila);
    if (propiedad) propiedades.push(propiedad);
    else descartadas += 1;
  }

  return { propiedades, descartadas };
}

module.exports = {
  parsearPropiedad,
  parsearCatalogo,
  valorDe,
  encajarEn,
  normalizarMoneda,
  sinTildes,
  COLUMNAS,
};
