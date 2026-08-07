const test = require('node:test');
const assert = require('node:assert');

const { matchProperties, aPesos, USD_TO_ARS } = require('../src/matchProperties');
const {
  formatPropertyReply,
  buildPhotoReply,
  describirCriterios,
  LARGO_MAXIMO_CAPTION,
} = require('../src/formatPropertyReply');
const propiedades = require('../src/properties.json');

test('el catálogo de demo tiene los campos requeridos y los ids son únicos', () => {
  assert.ok(propiedades.length >= 10, 'el catálogo quedó más chico de lo esperado');

  const ids = new Set();
  for (const propiedad of propiedades) {
    const campos = ['id', 'titulo', 'operacion', 'tipo', 'ciudad', 'barrio', 'dormitorios', 'banios', 'precio', 'moneda'];
    for (const campo of campos) {
      assert.ok(propiedad[campo] !== undefined, `${propiedad.id} no tiene ${campo}`);
    }
    assert.ok(['venta', 'alquiler'].includes(propiedad.operacion));
    assert.ok(['ARS', 'USD'].includes(propiedad.moneda));

    assert.ok(!ids.has(propiedad.id), `id repetido: ${propiedad.id}`);
    ids.add(propiedad.id);
  }
});

test('filtra por operación y tipo', () => {
  const { resultados, nivel } = matchProperties({ operacion: 'alquiler', tipo: 'departamento' }, propiedades);

  assert.strictEqual(nivel, 'exacto');
  assert.ok(resultados.length > 0);
  for (const propiedad of resultados) {
    assert.strictEqual(propiedad.operacion, 'alquiler');
    assert.strictEqual(propiedad.tipo, 'departamento');
  }
});

test('el barrio matchea sin importar tildes ni mayúsculas', () => {
  const conTilde = matchProperties({ barrio: 'Nueva Córdoba', operacion: 'alquiler' }, propiedades);
  const sinTilde = matchProperties({ barrio: 'nueva cordoba', operacion: 'alquiler' }, propiedades);

  assert.strictEqual(sinTilde.nivel, 'exacto');
  assert.deepStrictEqual(
    sinTilde.resultados.map((p) => p.id),
    conTilde.resultados.map((p) => p.id),
  );
});

test('dormitorios funciona como mínimo, no como igualdad', () => {
  const { resultados } = matchProperties({ operacion: 'venta', dormitorios: 3 }, propiedades);

  assert.ok(resultados.length > 0);
  for (const propiedad of resultados) {
    assert.ok(propiedad.dormitorios >= 3, `${propiedad.id} tiene ${propiedad.dormitorios} dormitorios`);
  }
});

test('respeta el presupuesto en pesos', () => {
  const tope = 400000;
  const { resultados } = matchProperties({ operacion: 'alquiler', presupuesto: tope, moneda: 'ARS' }, propiedades);

  assert.ok(resultados.length > 0);
  for (const propiedad of resultados) {
    assert.ok(aPesos(propiedad.precio, propiedad.moneda) <= tope);
  }
});

test('compara presupuestos en USD contra propiedades en USD', () => {
  const { resultados } = matchProperties(
    { operacion: 'venta', presupuesto: 80000, moneda: 'USD' },
    propiedades,
  );

  assert.ok(resultados.length > 0);
  for (const propiedad of resultados) {
    assert.ok(aPesos(propiedad.precio, propiedad.moneda) <= 80000 * USD_TO_ARS);
  }
});

test('devuelve como máximo 3 resultados', () => {
  const { resultados, total } = matchProperties({ operacion: 'alquiler' }, propiedades);

  assert.strictEqual(resultados.length, 3);
  assert.ok(total >= 3, 'total debe reflejar todas las coincidencias, no solo las devueltas');
});

test('prioriza el barrio pedido sobre el resto', () => {
  const { resultados } = matchProperties(
    { operacion: 'alquiler', tipo: 'departamento', barrio: 'General Paz' },
    propiedades,
  );

  assert.strictEqual(resultados[0].barrio, 'General Paz');
});

test('si el barrio no tiene stock, suelta el barrio y avisa', () => {
  const { resultados, nivel } = matchProperties(
    { operacion: 'venta', tipo: 'casa', barrio: 'Nueva Córdoba' },
    propiedades,
  );

  assert.strictEqual(nivel, 'sin_barrio');
  assert.ok(resultados.length > 0);
  for (const propiedad of resultados) {
    assert.strictEqual(propiedad.tipo, 'casa');
  }
});

test('si el presupuesto es muy bajo, lo amplía un 15% antes de rendirse', () => {
  // La casa más barata en venta son USD 78.000; con tope 70.000 solo entra al ampliar.
  const { nivel, resultados } = matchProperties(
    { operacion: 'venta', tipo: 'ph', presupuesto: 70000, moneda: 'USD' },
    propiedades,
  );

  assert.strictEqual(nivel, 'presupuesto_ampliado');
  assert.strictEqual(resultados[0].id, 'INM-009');
});

test('devuelve sin_resultados cuando de verdad no hay nada', () => {
  const { resultados, nivel, total } = matchProperties({ operacion: 'alquiler', tipo: 'castillo' }, propiedades);

  assert.strictEqual(nivel, 'sin_resultados');
  assert.strictEqual(resultados.length, 0);
  assert.strictEqual(total, 0);
});

test('es determinístico ante entradas iguales', () => {
  const criterios = { operacion: 'venta', dormitorios: 3 };
  const a = matchProperties(criterios, propiedades);
  const b = matchProperties(criterios, propiedades);

  assert.deepStrictEqual(a.resultados.map((p) => p.id), b.resultados.map((p) => p.id));
});

test('tolera criterios vacíos o inválidos sin romper', () => {
  assert.doesNotThrow(() => matchProperties(null, propiedades));
  assert.doesNotThrow(() => matchProperties({}, null));
  assert.strictEqual(matchProperties({}, null).nivel, 'sin_resultados');
});

test('formatPropertyReply arma un mensaje usable para WhatsApp', () => {
  const match = matchProperties({ operacion: 'alquiler', barrio: 'Nueva Córdoba' }, propiedades);
  const mensaje = formatPropertyReply(match, { agencia: 'Inmobiliaria Demo' });

  assert.match(mensaje, /Nueva Córdoba/);
  assert.match(mensaje, /Ref: INM-00/);
  assert.match(mensaje, /\*/, 'debe usar negrita de WhatsApp');
  assert.match(mensaje, /visita/i, 'debe cerrar invitando a coordinar');
  assert.ok(!mensaje.includes('\n\n\n'), 'no debe quedar con líneas en blanco de más');
});

test('formatPropertyReply avisa cuando no encontró nada', () => {
  const mensaje = formatPropertyReply({ resultados: [], nivel: 'sin_resultados', total: 0 }, {});

  assert.match(mensaje, /no encontré/i);
  assert.match(mensaje, /asesor/i, 'debe ofrecer la salida a un humano');
});

test('formatPropertyReply concuerda en singular con un solo resultado', () => {
  // Un barrio con una sola ficha, para que el caso no dependa del tamaño del
  // catálogo: al sumar propiedades esto se rompía por motivos ajenos al test.
  const match = matchProperties({ barrio: 'Urca' }, propiedades);
  assert.strictEqual(match.resultados.length, 1, 'el caso de prueba necesita un único resultado');

  const mensaje = formatPropertyReply(match, {});

  assert.match(mensaje, /esta opción que encaja con/);
  assert.ok(!mensaje.includes('que encajan'), 'no debe usar el plural con un solo resultado');
  assert.match(mensaje, /¿Te interesa\?/);
});

test('formatPropertyReply aclara cuando relajó el barrio', () => {
  const match = matchProperties({ operacion: 'venta', tipo: 'casa', barrio: 'Nueva Córdoba' }, propiedades);
  const mensaje = formatPropertyReply(match, {});

  assert.match(mensaje, /no encontré/i);
  assert.match(mensaje, /se acercan/i);
});

test('al relajar, el mensaje dice con qué criterios buscó', () => {
  // El caso real que lo motivó: el cliente pregunta por un barrio y la búsqueda
  // arrastra "2 dormitorios" de un mensaje anterior. Sin nombrarlo, el "no
  // encontré nada en Alberdi" parece falso, porque en Alberdi sí hay algo.
  const criterios = { tipo: 'departamento', barrio: 'Alberdi', dormitorios: 2 };
  const mensaje = formatPropertyReply(matchProperties(criterios, propiedades), { criterios });

  assert.match(mensaje, /departamentos/);
  assert.match(mensaje, /2 dormitorios/);
  assert.match(mensaje, /Alberdi/);
});

test('el mensaje nombra el filtro de baños', () => {
  const criterios = { tipo: 'departamento', barrio: 'Alberdi', banios: 2 };
  const mensaje = formatPropertyReply(matchProperties(criterios, propiedades), { criterios });

  assert.match(mensaje, /2 baños/);
});

test('describirCriterios usa singular y plural donde corresponde', () => {
  assert.match(describirCriterios({ dormitorios: 1 }), /1 dormitorio\b/);
  assert.match(describirCriterios({ dormitorios: 2 }), /2 dormitorios/);
  assert.match(describirCriterios({ banios: 1 }), /1 baño\b/);
  assert.match(describirCriterios({ banios: 2 }), /2 baños/);
  assert.match(describirCriterios({ tipo: 'casa' }), /^casas/);
  assert.match(describirCriterios({ tipo: 'local' }), /^locales/);
});

test('describirCriterios no dice nada cuando no hay criterios', () => {
  assert.strictEqual(describirCriterios({}), '');
  assert.strictEqual(describirCriterios(null), '');
  // Solo el barrio no cuenta: el barrio se nombra aparte en el encabezado.
  assert.strictEqual(describirCriterios({ barrio: 'Alberdi' }), '');
});

test('sin criterios que nombrar, el mensaje sigue siendo natural', () => {
  const criterios = { barrio: 'Alberdi' };
  const mensaje = formatPropertyReply(matchProperties(criterios, propiedades), { criterios });

  assert.ok(!mensaje.includes('undefined'));
  assert.ok(!mensaje.includes('null'));
  assert.match(mensaje, /Alberdi/);
});

test('filtra por baños: "con dos baños" descarta las de uno', () => {
  const { resultados } = matchProperties({ banios: 2 }, propiedades);

  assert.ok(resultados.length > 0);
  for (const propiedad of resultados) {
    assert.ok(propiedad.banios >= 2, `${propiedad.id} tiene ${propiedad.banios} baño(s)`);
  }
});

test('los baños son un mínimo, no un exacto', () => {
  // INM-006 tiene 3 baños: quien pide 2 no debe verlo descartado. Se acota por
  // barrio para no depender del recorte a 3 resultados.
  const { resultados } = matchProperties({ barrio: 'Cerro de las Rosas', banios: 2 }, propiedades);

  assert.ok(
    resultados.some((p) => p.id === 'INM-006'),
    'una propiedad con más baños que los pedidos tiene que seguir entrando',
  );
});

test('a igualdad de todo, prioriza el match exacto de baños', () => {
  const { resultados } = matchProperties({ banios: 2 }, propiedades);

  const exacto = resultados.findIndex((p) => p.banios === 2);
  const deMas = resultados.findIndex((p) => p.banios > 2);
  if (exacto !== -1 && deMas !== -1) {
    assert.ok(exacto < deMas, 'el de 2 baños debe ir antes que el de 3');
  }
});

test('combina baños con el resto de los criterios', () => {
  const { resultados } = matchProperties({ tipo: 'departamento', dormitorios: 2, banios: 2 }, propiedades);

  for (const propiedad of resultados) {
    assert.strictEqual(propiedad.tipo, 'departamento');
    assert.ok(propiedad.dormitorios >= 2);
    assert.ok(propiedad.banios >= 2);
  }
});

test('sin criterio de baños, no se filtra por baños', () => {
  const conFiltro = matchProperties({ banios: 3 }, propiedades).total;
  const sinFiltro = matchProperties({}, propiedades).total;

  assert.ok(sinFiltro > conFiltro, 'el filtro de baños tiene que achicar el resultado');
});

test('capitaliza el barrio en el mensaje aunque el cliente lo escriba en minúscula', () => {
  const criterios = { tipo: 'departamento', barrio: 'alberdi', dormitorios: 2 };
  const mensaje = formatPropertyReply(matchProperties(criterios, propiedades), { criterios });

  assert.match(mensaje, /en Alberdi/);
  assert.ok(!/en alberdi/.test(mensaje));
});

test('todas las propiedades del catálogo declaran ciudad', () => {
  for (const propiedad of propiedades) {
    assert.ok(propiedad.ciudad, `${propiedad.id} no tiene ciudad`);
  }
});

test('filtra por ciudad', () => {
  const { resultados } = matchProperties({ ciudad: 'Córdoba' }, propiedades);

  assert.ok(resultados.length > 0);
  for (const propiedad of resultados) {
    assert.strictEqual(propiedad.ciudad, 'Córdoba');
  }
});

test('la ciudad NO se relaja: antes decir que no hay, que mandar a otra ciudad', () => {
  // Una ciudad que no está en el catálogo no debe devolver propiedades de otra,
  // por más que el resto de los criterios encajen.
  const { resultados, nivel } = matchProperties(
    { ciudad: 'Rosario', tipo: 'departamento', operacion: 'alquiler' },
    propiedades,
  );

  assert.strictEqual(nivel, 'sin_resultados');
  assert.strictEqual(resultados.length, 0);
});

test('el barrio sí se relaja, pero dentro de la misma ciudad', () => {
  const { resultados, nivel } = matchProperties(
    { ciudad: 'Córdoba', barrio: 'Un Barrio Que No Existe', operacion: 'alquiler' },
    propiedades,
  );

  assert.strictEqual(nivel, 'sin_barrio');
  assert.ok(resultados.length > 0);
  for (const propiedad of resultados) {
    assert.strictEqual(propiedad.ciudad, 'Córdoba');
  }
});

test('la ciudad matchea sin importar tildes ni mayúsculas', () => {
  const conTilde = matchProperties({ ciudad: 'Córdoba', operacion: 'venta' }, propiedades);
  const sinTilde = matchProperties({ ciudad: 'cordoba', operacion: 'venta' }, propiedades);

  assert.deepStrictEqual(
    sinTilde.resultados.map((p) => p.id),
    conTilde.resultados.map((p) => p.id),
  );
});

test('el listado muestra la ciudad junto al barrio', () => {
  const match = matchProperties({ ciudad: 'Córdoba', barrio: 'Nueva Córdoba' }, propiedades);
  const mensaje = formatPropertyReply(match, {});

  assert.match(mensaje, /Nueva Córdoba, Córdoba/);
});

test('cuando no hay nada en esa ciudad, el mensaje la nombra', () => {
  const criterios = { ciudad: 'Rosario' };
  const mensaje = formatPropertyReply(matchProperties(criterios, propiedades), { criterios });

  assert.match(mensaje, /en Rosario/);
  assert.match(mensaje, /otra localidad|asesor/i);
});

test('el catálogo cubre las dos ciudades', () => {
  const ciudades = new Set(propiedades.map((p) => p.ciudad));

  assert.ok(ciudades.has('Córdoba'));
  assert.ok(ciudades.has('Río Tercero'));
});

test('Alberdi existe en las dos ciudades y la ciudad las separa', () => {
  // El caso que justifica el campo ciudad: mismo nombre de barrio, dos
  // localidades a 100 km. Sin filtrar por ciudad se mezclarían.
  const enAlberdi = propiedades.filter((p) => p.barrio === 'Alberdi');
  assert.ok(enAlberdi.length >= 2, 'el catálogo necesita Alberdi en ambas ciudades');

  const capital = matchProperties({ ciudad: 'Córdoba', barrio: 'Alberdi' }, propiedades);
  const interior = matchProperties({ ciudad: 'Río Tercero', barrio: 'Alberdi' }, propiedades);

  for (const p of capital.resultados) assert.strictEqual(p.ciudad, 'Córdoba');
  for (const p of interior.resultados) assert.strictEqual(p.ciudad, 'Río Tercero');
  assert.notDeepStrictEqual(
    capital.resultados.map((p) => p.id),
    interior.resultados.map((p) => p.id),
  );
});

test('sin ciudad, "Alberdi" trae las de ambas localidades', () => {
  const { resultados } = matchProperties({ barrio: 'Alberdi' }, propiedades);
  const ciudades = new Set(resultados.map((p) => p.ciudad));

  assert.ok(ciudades.size > 1, 'debe mezclar mientras el cliente no aclare la ciudad');
});

test('el barrio matchea con o sin el prefijo "Barrio"', () => {
  const conPrefijo = matchProperties({ ciudad: 'Río Tercero', barrio: 'Barrio Norte' }, propiedades);
  const sinPrefijo = matchProperties({ ciudad: 'Río Tercero', barrio: 'Norte' }, propiedades);

  assert.strictEqual(conPrefijo.nivel, 'exacto');
  assert.deepStrictEqual(
    sinPrefijo.resultados.map((p) => p.id),
    conPrefijo.resultados.map((p) => p.id),
  );
});

test('también al revés: el cliente agrega "Barrio" y la ficha no lo tiene', () => {
  const { resultados, nivel } = matchProperties({ ciudad: 'Río Tercero', barrio: 'Barrio Las Flores' }, propiedades);

  assert.strictEqual(nivel, 'exacto');
  assert.strictEqual(resultados[0].barrio, 'Las Flores');
});

test('el listado muestra la dirección cuando la ficha la tiene', () => {
  const match = matchProperties({ ciudad: 'Río Tercero', barrio: 'Las Flores' }, propiedades);
  const mensaje = formatPropertyReply(match, {});

  assert.match(mensaje, /Lorenzo Capandegui 570/);
});

test('las fichas sin dirección no dejan una línea vacía', () => {
  const match = matchProperties({ ciudad: 'Córdoba', barrio: 'Nueva Córdoba' }, propiedades);
  const mensaje = formatPropertyReply(match, {});

  assert.ok(!mensaje.includes('🗺️ \n'));
  assert.ok(!mensaje.includes('undefined'));
});

test('buildPhotoReply manda una foto por propiedad y el texto queda de encabezado', () => {
  const criterios = { ciudad: 'Río Tercero' };
  const { texto, fotos } = buildPhotoReply(matchProperties(criterios, propiedades), { criterios });

  assert.strictEqual(fotos.length, 3, 'una foto por resultado');
  for (const foto of fotos) {
    assert.match(foto.link, /^https:\/\//, 'Meta necesita una URL pública');
    assert.match(foto.caption, /Ref: INM-/, 'la ficha va en el pie de foto');
  }

  // El texto no repite las fichas: para eso están los pies de foto.
  assert.ok(!texto.includes('Ref: INM-'), 'las fichas no van duplicadas en el texto');
  assert.match(texto, /¿Te interesa alguna\?/);
});

test('buildPhotoReply no pierde las propiedades que no tienen foto', () => {
  const sinFoto = propiedades.map((p) => (p.id === 'INM-101' ? { ...p, foto: undefined } : p));
  const criterios = { ciudad: 'Río Tercero', barrio: 'Las Flores' };
  const { texto, fotos } = buildPhotoReply(matchProperties(criterios, sinFoto), { criterios });

  assert.strictEqual(fotos.length, 0);
  assert.match(texto, /Ref: INM-101/, 'sin foto, la ficha tiene que ir en el texto');
});

test('buildPhotoReply cae al mensaje de siempre si no encontró nada', () => {
  const criterios = { ciudad: 'Rosario' };
  const { texto, fotos } = buildPhotoReply(matchProperties(criterios, propiedades), { criterios });

  assert.strictEqual(fotos.length, 0);
  assert.match(texto, /no encontré/i);
});

test('el pie de foto nunca supera el límite de WhatsApp', () => {
  const largo = propiedades.map((p) => ({
    ...p,
    destacados: Array.from({ length: 40 }, (_, i) => `Característica muy larga número ${i}`),
  }));
  const { fotos } = buildPhotoReply(matchProperties({ ciudad: 'Córdoba' }, largo), {});

  for (const foto of fotos) {
    assert.ok(foto.caption.length <= LARGO_MAXIMO_CAPTION, `pie de foto de ${foto.caption.length} caracteres`);
  }
});

test('todas las propiedades del catálogo tienen foto', () => {
  for (const propiedad of propiedades) {
    assert.match(propiedad.foto || '', /^https:\/\/images\.unsplash\.com\//, `${propiedad.id} sin foto`);
  }
  const fotos = propiedades.map((p) => p.foto);
  assert.strictEqual(new Set(fotos).size, fotos.length, 'no debería haber fotos repetidas');
});

// ---------------------------------------------------------------------------
// Búsqueda por nombre, y "mostrame las otras"
// ---------------------------------------------------------------------------

/** Un catálogo chico con una propiedad de nombre propio, como las cargan las agencias. */
const CATALOGO_CON_NOMBRE = [
  { id: 'INM-800', titulo: 'Casa de Messi', tipo: 'departamento', ciudad: 'Río Tercero', barrio: 'Alto Alegre', dormitorios: 8, banios: 4, precio: 4000000, moneda: 'ARS', destacados: [] },
  { id: 'INM-105', titulo: 'Casa con jardín', tipo: 'casa', ciudad: 'Río Tercero', barrio: 'Roque Sáenz Peña', dormitorios: 3, banios: 2, precio: 550000, moneda: 'ARS', destacados: ['Quincho'] },
  { id: 'INM-102', titulo: 'Casa amplia en Alberdi', tipo: 'casa', ciudad: 'Río Tercero', barrio: 'Alberdi', dormitorios: 3, banios: 2, precio: 78000, moneda: 'USD', destacados: ['Parrilla'] },
];

test('se puede pedir una propiedad por su nombre', () => {
  // El caso real: "la casa de Messi tenés?" devolvía dos casas cualquiera,
  // porque el nombre no se usaba para nada y mandaban los filtros viejos.
  const { resultados } = matchProperties({ busqueda_libre: 'la casa de Messi' }, CATALOGO_CON_NOMBRE);

  assert.strictEqual(resultados.length, 1);
  assert.strictEqual(resultados[0].id, 'INM-800');
});

test('el nombre pedido manda por encima de los filtros arrastrados', () => {
  // INM-800 está cargada como departamento y tiene 8 dormitorios: con los
  // criterios de la búsqueda anterior encima, quedaba descartada dos veces.
  const { resultados } = matchProperties(
    { busqueda_libre: 'casa de Messi', tipo: 'casa', dormitorios: 3, ciudad: 'Río Tercero' },
    CATALOGO_CON_NOMBRE,
  );

  assert.deepStrictEqual(resultados.map((r) => r.id), ['INM-800']);
});

test('buscar por nombre no devuelve el catálogo entero', () => {
  // "casa" está en el título de las tres: si contara como palabra de
  // búsqueda, pedir una por nombre traería todas.
  const { resultados } = matchProperties({ busqueda_libre: 'una casa' }, CATALOGO_CON_NOMBRE);

  assert.strictEqual(resultados.length, 3, 'sin nada distintivo, no filtra');

  const { resultados: alberdi } = matchProperties({ busqueda_libre: 'la de Alberdi' }, CATALOGO_CON_NOMBRE);
  assert.deepStrictEqual(alberdi.map((r) => r.id), ['INM-102']);
});

test('"mostrame las otras" no repite las que ya vio', () => {
  const primera = matchProperties({ ciudad: 'Río Tercero' }, CATALOGO_CON_NOMBRE);
  assert.strictEqual(primera.resultados.length, 3);

  const segunda = matchProperties({ ciudad: 'Río Tercero' }, CATALOGO_CON_NOMBRE, {
    excluir: ['INM-800', 'INM-105'],
  });

  assert.deepStrictEqual(segunda.resultados.map((r) => r.id), ['INM-102']);
  assert.strictEqual(segunda.totalSinExcluir, 3, 'el total real no cambia');
});

test('cuando ya vio todas, se distingue de no tener nada', () => {
  // Para el cliente son dos respuestas muy distintas: "no tengo nada así" o
  // "ya te mostré todo lo que tengo así".
  const agotado = matchProperties({ ciudad: 'Río Tercero' }, CATALOGO_CON_NOMBRE, {
    excluir: ['INM-800', 'INM-105', 'INM-102'],
  });

  assert.strictEqual(agotado.resultados.length, 0);
  assert.strictEqual(agotado.agotadas, true);
  assert.strictEqual(agotado.totalSinExcluir, 3);

  const sinNada = matchProperties({ ciudad: 'Villa María' }, CATALOGO_CON_NOMBRE);
  assert.strictEqual(sinNada.agotadas, false, 'esto sí es "no tengo nada"');

  // Y el mensaje lo refleja.
  const mensaje = formatPropertyReply(agotado, { agencia: 'Nicola', criterios: { ciudad: 'Río Tercero' } });
  assert.match(mensaje, /todas las que tengo/i);
  assert.ok(!/no encontré nada/i.test(mensaje));
});
