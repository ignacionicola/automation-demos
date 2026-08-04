const test = require('node:test');
const assert = require('node:assert');

const { parsearPropiedad, parsearCatalogo } = require('../src/sheetCatalog');
const { matchProperties } = require('../src/matchProperties');

/** Una fila como la escribiría alguien en la planilla. */
const FILA = {
  id: 'INM-101',
  titulo: 'Departamento familiar en Las Flores',
  operacion: 'Alquiler',
  tipo: 'Departamento',
  ciudad: 'Río Tercero',
  barrio: 'Las Flores',
  direccion: 'Lorenzo Capandegui 570',
  dormitorios: '2',
  baños: '2',
  superficie: '75 m2',
  cochera: 'sí',
  precio: '$ 420.000',
  moneda: 'ARS',
  expensas: '95.000',
  descripcion: 'Muy luminoso.',
  destacados: 'Balcón | Cochera | Apto crédito',
  foto: 'https://ejemplo.com/101.jpg',
};

test('una fila de la planilla se convierte en una propiedad usable', () => {
  const p = parsearPropiedad(FILA);

  assert.strictEqual(p.id, 'INM-101');
  assert.strictEqual(p.operacion, 'alquiler');
  assert.strictEqual(p.tipo, 'departamento');
  assert.strictEqual(p.dormitorios, 2);
  assert.strictEqual(p.banios, 2);
  assert.strictEqual(p.superficie_m2, 75);
  assert.strictEqual(p.cochera, true);
  assert.strictEqual(p.precio, 420000);
  assert.strictEqual(p.expensas, 95000);
  assert.deepStrictEqual(p.destacados, ['Balcón', 'Cochera', 'Apto crédito']);
  assert.strictEqual(p.foto, 'https://ejemplo.com/101.jpg');
});

test('los encabezados admiten las variantes que la gente escribe', () => {
  // Nadie va a escribir "superficie_m2" ni "banios" con la misma grafía dos
  // veces. Exigirlo sería garantizar que la planilla del cliente no funcione.
  const p = parsearPropiedad({
    codigo: 'INM-9',
    Operación: 'venta',
    Tipo: 'casa',
    Localidad: 'Córdoba',
    Zona: 'Alberdi',
    Dormitorios: '3',
    Banos: '2',
    m2: '140',
    Garage: 'no',
    Valor: 'USD 78.000',
    Moneda: 'usd',
    'URL de la imagen': 'https://ejemplo.com/9.jpg',
  });

  assert.strictEqual(p.id, 'INM-9');
  assert.strictEqual(p.tipo, 'casa');
  assert.strictEqual(p.barrio, 'Alberdi');
  assert.strictEqual(p.banios, 2);
  assert.strictEqual(p.cochera, false);
  assert.strictEqual(p.moneda, 'USD');
  assert.strictEqual(p.foto, 'https://ejemplo.com/9.jpg');
});

test('el código se normaliza a mayúsculas para poder buscarlo', () => {
  assert.strictEqual(parsearPropiedad({ id: ' inm-101 ' }).id, 'INM-101');
});

test('una fila incompleta entra igual, con lo que tenga', () => {
  // Descartar una propiedad real por un dato faltante es peor que mostrarla
  // sin metros cuadrados: el cliente directamente no se entera de que existe.
  const p = parsearPropiedad({ id: 'INM-7', titulo: 'Lote en Alberdi' });

  assert.strictEqual(p.id, 'INM-7');
  assert.strictEqual(p.precio, null);
  assert.strictEqual(p.moneda, null, 'sin precio, la moneda no significa nada');
  assert.deepStrictEqual(p.destacados, []);
  assert.strictEqual(p.foto, null);
});

test('sin código la fila se descarta y se cuenta', () => {
  // Es la fila vacía del final de toda planilla, o una fila de notas.
  const { propiedades, descartadas } = parsearCatalogo([
    FILA,
    { titulo: 'anotación mía', precio: '100' },
    {},
  ]);

  assert.strictEqual(propiedades.length, 1);
  assert.strictEqual(descartadas, 2);
});

test('una operación o un tipo desconocidos quedan en null, no inventados', () => {
  // Un valor inventado dejaría la propiedad fuera de toda búsqueda sin que
  // nadie entienda por qué; en null, simplemente no filtra por eso.
  const p = parsearPropiedad({ id: 'INM-8', operacion: 'permuta', tipo: 'galpón' });

  assert.strictEqual(p.operacion, null);
  assert.strictEqual(p.tipo, null);
});

test('el catálogo de la planilla funciona con la búsqueda real', () => {
  // La prueba que importa: que lo parseado entre por matchProperties sin
  // adaptadores en el medio.
  const { propiedades } = parsearCatalogo([
    FILA,
    { ...FILA, id: 'INM-102', barrio: 'Alberdi', precio: '$ 900.000', dormitorios: '3' },
  ]);

  const { resultados } = matchProperties(
    { operacion: 'alquiler', ciudad: 'Río Tercero', dormitorios: 2, banios: 2 },
    propiedades,
  );

  assert.ok(resultados.length > 0, 'la planilla tiene que producir resultados');
  assert.strictEqual(resultados[0].id, 'INM-101');
});
