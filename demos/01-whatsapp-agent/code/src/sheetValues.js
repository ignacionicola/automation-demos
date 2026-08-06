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

// Páginas que MUESTRAN una imagen pero no la sirven. Es lo que copia cualquiera
// de la barra de direcciones, y no se puede distinguir mirando la URL: tiene
// forma perfecta de link.
//
// Importa más de lo que parece. Meta descarga la imagen desde su servidor: si
// recibe HTML en vez de bytes, igual acepta el envío y devuelve un ID de
// mensaje, y recién después lo descarta en silencio. Nadie se entera — ni el
// cliente, ni la inmobiliaria, ni el log. Y como la propiedad se fue por la
// rama de fotos, tampoco aparece en el texto: desaparece del chat entera.
//
// Por eso se descartan acá: sin foto, la ficha vuelve al mensaje de texto y la
// propiedad se ve igual. Una foto de menos es mucho mejor que una propiedad
// que el cliente nunca supo que existía.
const PAGINAS_QUE_NO_SIRVEN_LA_IMAGEN = [
  /^https?:\/\/(www\.)?unsplash\.com\//i,
  /^https?:\/\/(www\.)?pexels\.com\//i,
  /^https?:\/\/(www\.)?pixabay\.com\//i,
  /^https?:\/\/(www\.)?flickr\.com\//i,
  // Pinterest sirve las imágenes desde otro dominio (pinimg.com), así que acá
  // se puede descartar cualquier subdominio. Unsplash y Pexels no: sus CDN son
  // images.unsplash.com e images.pexels.com, que sí hay que dejar pasar.
  /^https?:\/\/[\w-]*\.?pinterest\.[a-z.]+\//i,
  /^https?:\/\/photos\.google\.com\//i,
  /^https?:\/\/(www\.)?icloud\.com\//i,
];

// Estas sí se pueden arreglar solas, y son las que una inmobiliaria va a usar
// de verdad: el link que copia del botón "Compartir" apunta a la página, pero
// el archivo está a un parámetro de distancia.
const REPARABLES = [
  {
    reconoce: /^https?:\/\/drive\.google\.com\/file\/d\/([^/?#]+)/i,
    arregla: (m) => `https://drive.google.com/uc?export=view&id=${m[1]}`,
  },
  {
    reconoce: /^(https?:\/\/(?:www\.)?dropbox\.com\/[^?#]+)/i,
    arregla: (m) => `${m[1]}?raw=1`,
  },
  {
    // El CDN de Unsplash negocia el formato con quien pide: `auto=format` le
    // sirve AVIF o WebP a cualquiera que los acepte, y WhatsApp solo entiende
    // JPEG y PNG. Meta acepta el envío, descarga un AVIF y descarta el mensaje
    // sin decir nada, igual que con una página HTML.
    //
    // Cuesta encontrarlo porque un `curl` normal recibe JPEG —no manda el
    // Accept que dispara la negociación—, así que la URL parece sana.
    reconoce: /^https?:\/\/images\.unsplash\.com\/[^?#]+/i,
    arregla: (m) => `${m[0]}?w=1080&q=80&fm=jpg`,
  },
];

/**
 * URL de imagen de una celda, o null.
 *
 * Devuelve null tanto si no es una URL ("ver carpeta", una ruta local) como si
 * es una URL que no va a devolver una imagen. Quien llama trata los dos casos
 * igual: la propiedad no tiene foto.
 */
function celdaUrl(valor) {
  const texto = celdaTexto(valor);
  if (!/^https?:\/\/\S+$/i.test(texto)) return null;

  for (const { reconoce, arregla } of REPARABLES) {
    const encontrado = texto.match(reconoce);
    if (encontrado) return arregla(encontrado);
  }

  if (PAGINAS_QUE_NO_SIRVEN_LA_IMAGEN.some((patron) => patron.test(texto))) return null;

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
