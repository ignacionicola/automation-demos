/**
 * Estos tests son el corazón de la migración a Sheets. La integración con la
 * API son dos nodos; el trabajo real es que una planilla escrita a mano por
 * una persona no rompa la búsqueda.
 */
const test = require('node:test');
const assert = require('node:assert');

const { celdaTexto, celdaNumero, celdaEntero, celdaBooleano, celdaLista, celdaUrl } = require('../src/sheetValues');

test('entiende los precios como los escribe una persona', () => {
  // El punto separa miles en Argentina, al revés que en JS: "420.000"
  // parseado a la ligera da 420 y la propiedad aparece como una ganga.
  assert.strictEqual(celdaNumero('420.000'), 420000);
  assert.strictEqual(celdaNumero('$ 420.000'), 420000);
  assert.strictEqual(celdaNumero('USD 52.000'), 52000);
  assert.strictEqual(celdaNumero('420000'), 420000);
  assert.strictEqual(celdaNumero(420000), 420000);
  assert.strictEqual(celdaNumero(' 1.234,56 '), 1234.56);
  assert.strictEqual(celdaNumero('75 m2'), 75);
});

test('un precio ilegible vale null, no cero', () => {
  // Cero sería un precio: entraría en cualquier búsqueda por presupuesto y
  // la propiedad aparecería como regalada.
  for (const basura of ['', '   ', 'a convenir', 'consultar', null, undefined, 'dos']) {
    assert.strictEqual(celdaNumero(basura), null, `${JSON.stringify(basura)} no es un número`);
  }
});

test('los enteros se redondean en vez de romper la búsqueda', () => {
  assert.strictEqual(celdaEntero('2'), 2);
  assert.strictEqual(celdaEntero('2,5'), 3);
  assert.strictEqual(celdaEntero('sin datos'), null);
});

test('entiende las mil formas de decir que sí', () => {
  for (const si of ['sí', 'si', 'SI', 'x', 'X', 'TRUE', true, '1', 'ok']) {
    assert.strictEqual(celdaBooleano(si), true, `${JSON.stringify(si)} debería ser true`);
  }
  for (const no of ['no', 'NO', 'false', '0', '', '   ', null, undefined, '-']) {
    assert.strictEqual(celdaBooleano(no), false, `${JSON.stringify(no)} debería ser false`);
  }
});

test('un texto cualquiera en una columna de sí/no cuenta como que sí', () => {
  // "cochera cubierta" o "2 cocheras" describen algo que está. Lo que no está
  // es lo que se deja vacío.
  assert.strictEqual(celdaBooleano('cochera cubierta'), true);
  assert.strictEqual(celdaBooleano('2 cocheras'), true);
});

test('las listas aceptan cualquier separador razonable', () => {
  assert.deepStrictEqual(celdaLista('Balcón | Cochera | Apto crédito'), ['Balcón', 'Cochera', 'Apto crédito']);
  assert.deepStrictEqual(celdaLista('Balcón\nCochera'), ['Balcón', 'Cochera']);
  assert.deepStrictEqual(celdaLista('Balcón · Cochera'), ['Balcón', 'Cochera']);
  assert.deepStrictEqual(celdaLista('Balcón; Cochera'), ['Balcón', 'Cochera']);
  assert.deepStrictEqual(celdaLista('  Balcón  '), ['Balcón']);
  assert.deepStrictEqual(celdaLista(''), []);
});

test('solo se acepta una URL que Meta pueda descargar', () => {
  assert.strictEqual(celdaUrl('https://ejemplo.com/foto.jpg'), 'https://ejemplo.com/foto.jpg');
  // Meta baja la imagen desde su servidor: una nota o una ruta local no sirven.
  for (const invalida of ['ver carpeta', 'C:\\fotos\\1.jpg', 'foto.jpg', '', null]) {
    assert.strictEqual(celdaUrl(invalida), null, `${JSON.stringify(invalida)} no es una URL usable`);
  }
});

test('celdaTexto no propaga null ni undefined al mensaje', () => {
  assert.strictEqual(celdaTexto(null), '');
  assert.strictEqual(celdaTexto(undefined), '');
  assert.strictEqual(celdaTexto('  hola  '), 'hola');
  assert.strictEqual(celdaTexto(42), '42');
});
