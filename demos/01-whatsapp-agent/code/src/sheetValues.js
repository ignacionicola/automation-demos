/**
 * Interpretación de celdas de Google Sheets.
 *
 * Existe porque una planilla no es una base de datos: todo llega como texto y
 * lo escribió una persona. El mismo precio puede venir como `420000`,
 * `420.000`, `$ 420.000` o `USD 52.000`; "tiene cochera" como `sí`, `SI`, `x`
 * o `TRUE`. Nada de eso es culpa de quien carga los datos — es lo que pasa
 * cuando el backend es una planilla, que es justamente lo que la hace usable
 * para una inmobiliaria.
 *
 * La regla es no romper nunca: una celda que no se entiende vale null, y quien
 * llama decide. Un precio ilegible no puede tirar abajo la búsqueda entera.
 *
 * Nombres con sufijo "DeCelda" a propósito: estas funciones se inyectan en los
 * mismos Code nodes que matchProperties.js y calendarEvent.js, que ya tienen
 * sus propios normalizadores. Ver build-workflow.js.
 */

// Formato argentino: el punto separa miles y la coma decimales. Es al revés
// que en JS, así que "420.000" parseado a la ligera da 420.
const SEPARADOR_MILES = /\./g;

const VERDADEROS = new Set(['si', 'sí', 'yes', 'true', 'verdadero', 'x', '1', 'ok', 'tiene']);
const FALSOS = new Set(['no', 'false', 'falso', '0', '-', 'sin']);

// Cualquiera de estos separa los ítems de una celda de lista. Se aceptan
// varios porque nadie va a recordar cuál era el correcto.
const SEPARADORES_DE_LISTA = /[\n|;·•]+/;

function celdaTexto(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

/**
 * Número de una celda, tolerando símbolos de moneda, espacios y separadores de
 * miles. Devuelve null si no hay nada numérico que rescatar — incluido el caso
 * de que alguien escriba "dos".
 */
function celdaNumero(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;

  const texto = celdaTexto(valor);
  if (!texto) return null;

  // Se toma el primer número que aparezca, en vez de borrar todo lo que no sea
  // dígito: con eso último, "75 m2" daba 752 — el 2 de "m2" se pegaba al
  // final y la propiedad pasaba a tener 752 metros cuadrados.
  const encontrado = texto.match(/-?\d[\d.,]*/);
  if (!encontrado) return null;

  // Una coma o un punto colgando al final no son separadores de nada.
  const limpio = encontrado[0].replace(/[.,]+$/, '');

  const tieneComa = limpio.includes(',');
  // Con coma, ella es el decimal y los puntos son miles. Sin coma, un punto
  // podría ser cualquiera de las dos cosas: "420.000" son cuatrocientos veinte
  // mil, no 420 con 0 decimales, así que se lo trata como miles.
  const normalizado = tieneComa
    ? limpio.replace(SEPARADOR_MILES, '').replace(',', '.')
    : limpio.replace(SEPARADOR_MILES, '');

  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

/** Entero de una celda; null si no es un entero razonable. */
function celdaEntero(valor) {
  const numero = celdaNumero(valor);
  if (numero === null) return null;
  return Number.isInteger(numero) ? numero : Math.round(numero);
}

/**
 * Booleano de una celda. Una celda vacía es `false`, no null: "no dice que
 * tenga cochera" y "dice que no tiene cochera" dan lo mismo para una búsqueda.
 */
function celdaBooleano(valor) {
  if (typeof valor === 'boolean') return valor;

  const texto = celdaTexto(valor).toLowerCase();
  if (!texto) return false;
  if (VERDADEROS.has(texto)) return true;
  if (FALSOS.has(texto)) return false;

  // Cualquier otro texto se interpreta como que algo hay: "cochera cubierta",
  // "2 cocheras". Lo que no está es lo que se deja vacío.
  return true;
}

/** Lista de una celda, separada por saltos de línea, |, ; o · */
function celdaLista(valor) {
  if (Array.isArray(valor)) return valor.map(celdaTexto).filter(Boolean);

  const texto = celdaTexto(valor);
  if (!texto) return [];

  return texto
    .split(SEPARADORES_DE_LISTA)
    .map((parte) => parte.trim())
    .filter(Boolean);
}

/**
 * URL de una celda, o null. Solo http(s): una celda con "ver carpeta" o una
 * ruta local no sirve para que Meta descargue la imagen desde su servidor.
 */
function celdaUrl(valor) {
  const texto = celdaTexto(valor);
  if (!/^https?:\/\/\S+$/i.test(texto)) return null;
  return texto;
}

module.exports = {
  celdaTexto,
  celdaNumero,
  celdaEntero,
  celdaBooleano,
  celdaLista,
  celdaUrl,
};
