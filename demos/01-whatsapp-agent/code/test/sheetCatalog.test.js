const test = require('node:test');
const assert = require('node:assert');

const { parsearPropiedad, parsearCatalogo, filasDeRango, buscarRango } = require('../src/sheetCatalog');
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

test('los rangos se ubican por nombre, no por el orden en que vuelven', () => {
  // Pasó de verdad: se pidió propiedades/negocio/faq y Google devolvió la faq
  // primera. Leyéndolos por índice, las 8 filas de la FAQ se parsearon como el
  // catálogo y el agente contestó que no tenía nada en Río Tercero — teniendo
  // seis propiedades ahí.
  const rangos = [
    { range: 'faq!A1:Z1000', values: [['id']] },
    { range: 'propiedades!A1:Z1000', values: [['id']] },
    { range: "'negocio'!A1:Z1000", values: [['clave']] },
  ];

  assert.strictEqual(buscarRango(rangos, 'propiedades').range, 'propiedades!A1:Z1000');
  assert.strictEqual(buscarRango(rangos, 'faq').range, 'faq!A1:Z1000');
  // Sheets entrecomilla el nombre cuando tiene espacios o caracteres raros.
  assert.strictEqual(buscarRango(rangos, 'negocio').range, "'negocio'!A1:Z1000");
  assert.strictEqual(buscarRango(rangos, 'inexistente'), null);
  assert.strictEqual(buscarRango(null, 'propiedades'), null);
});

test('las filas de batchGet se convierten en objetos por encabezado', () => {
  // batchGet devuelve arrays y la primera fila son los encabezados. Los nodos
  // de Google Sheets hacían esta conversión solos, pero cada uno costaba un
  // token: ahora se traen las tres pestañas de una y se arma acá.
  const filas = filasDeRango({
    range: 'propiedades!A1:Z1000',
    values: [
      ['id', 'titulo', 'precio'],
      ['INM-101', 'Casa en Las Flores', '420.000'],
      ['INM-102', 'PH en Alberdi', ''],
    ],
  });

  assert.deepStrictEqual(filas, [
    { id: 'INM-101', titulo: 'Casa en Las Flores', precio: '420.000' },
    { id: 'INM-102', titulo: 'PH en Alberdi', precio: '' },
  ]);
});

test('las filas vacías del final de la planilla no ensucian nada', () => {
  // Toda planilla tiene unas cuantas, y Sheets manda arrays cortos cuando las
  // últimas columnas están vacías.
  const filas = filasDeRango({
    values: [
      ['id', 'titulo', 'precio'],
      ['INM-101'],
      [],
      ['', '', ''],
    ],
  });

  assert.strictEqual(filas.length, 1);
  assert.deepStrictEqual(filas[0], { id: 'INM-101', titulo: '', precio: '' });
});

test('un rango que no vino no rompe: son cero filas', () => {
  // Es lo que pasa cuando la llamada falla — construirConfig lo lee como
  // pestaña vacía y cae al respaldo del repo.
  for (const vacio of [undefined, null, {}, { values: [] }, { values: [['id', 'titulo']] }]) {
    assert.deepStrictEqual(filasDeRango(vacio), [], JSON.stringify(vacio));
  }
});

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

test('una propiedad con la foto mal cargada sigue apareciendo', () => {
  // El bug que arregla: la URL de una página de Unsplash pasaba el filtro, la
  // propiedad se iba por la rama de fotos, Meta descartaba el mensaje y la
  // propiedad no aparecía por ningún lado. Sin foto vuelve al texto, que es
  // muchísimo mejor que desaparecer.
  const { propiedades, fotosDescartadas } = parsearCatalogo([
    { ...FILA, id: 'INM-1', foto: 'https://unsplash.com/es/fotos/una-casa-linda-RKdLlTyjm5g' },
    { ...FILA, id: 'INM-2', foto: 'https://ejemplo.com/real.jpg' },
    { ...FILA, id: 'INM-3', foto: '' },
  ]);

  assert.strictEqual(propiedades.length, 3, 'ninguna se pierde');
  assert.strictEqual(propiedades[0].foto, null, 'la página se descarta');
  assert.strictEqual(propiedades[1].foto, 'https://ejemplo.com/real.jpg');
  assert.strictEqual(
    fotosDescartadas,
    1,
    'solo cuenta la que traía algo cargado, no la celda vacía',
  );
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

test('una fila pegada dentro de una celda no crea una propiedad', () => {
  // Error de carga real: se pegó la fila entera en la columna del código.
  // Sheets lo acepta, y salía una propiedad fantasma sin ciudad, sin precio y
  // sin foto que igual ocupaba un lugar en los resultados.
  const pegoteada = 'INM-800\tCASA DE MESSI\tALQUILER\tDEPARTAMENTO\tRÍO TERCERO\tALTO ALEGRE\t8\t8';

  assert.strictEqual(parsearPropiedad({ id: pegoteada }), null);

  const { propiedades, descartadas } = parsearCatalogo([
    { id: 'INM-800', titulo: 'Casa de Messi' },
    { id: pegoteada },
  ]);
  assert.deepStrictEqual(propiedades.map((p) => p.id), ['INM-800']);
  assert.strictEqual(descartadas, 1);
});

test('los códigos normales siguen entrando', () => {
  for (const id of ['INM-101', 'CASA-7', 'A1', 'REF_2026-014', 'PROP.900']) {
    assert.ok(parsearPropiedad({ id }), `"${id}" debería ser un código válido`);
  }
});
