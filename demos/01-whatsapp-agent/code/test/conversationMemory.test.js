const test = require('node:test');
const assert = require('node:assert');

const {
  combinarEntidades,
  parseEstado,
  serializarEstado,
  estaVigente,
  conversacionActiva,
  agregarMensaje,
  recordarPropiedadesMostradas,
  reemplazarUltimoMensaje,
  fusionarEntidades,
  formatearContexto,
  TTL_INACTIVIDAD_MS,
  MAX_MENSAJES,
} = require('../src/conversationMemory');

const AHORA = 1_700_000_000_000;

// Simula el ciclo completo de una ejecución: leer la fila, registrar el
// mensaje entrante, y después fusionar lo que extrajo el clasificador.
function turno(filaGuardada, mensaje, entidadesDelModelo, ahora) {
  const previa = conversacionActiva(filaGuardada, ahora);
  const conMensaje = agregarMensaje(previa, { mensaje }, ahora);
  const contexto = formatearContexto(conMensaje, mensaje);
  const final = fusionarEntidades(conMensaje, entidadesDelModelo, ahora);
  return { contexto, fila: serializarEstado(final), conversacion: final };
}

test('el primer mensaje no tiene contexto previo', () => {
  const { contexto } = turno(null, 'busco depto en Nueva Córdoba', {}, AHORA);

  assert.strictEqual(contexto, '');
});

test('el caso que motivó la memoria: el barrio sobrevive al segundo mensaje', () => {
  const primero = turno(
    null,
    'busco depto en alquiler en Nueva Córdoba',
    { operacion: 'alquiler', tipo: 'departamento', barrio: 'Nueva Córdoba' },
    AHORA,
  );

  // Segundo mensaje: el modelo solo extrae los dormitorios.
  const segundo = turno(primero.fila, 'algo de un dormitorio', { dormitorios: 1 }, AHORA + 60_000);

  assert.strictEqual(segundo.conversacion.entidades.barrio, 'Nueva Córdoba');
  assert.strictEqual(segundo.conversacion.entidades.operacion, 'alquiler');
  assert.strictEqual(segundo.conversacion.entidades.tipo, 'departamento');
  assert.strictEqual(segundo.conversacion.entidades.dormitorios, 1);
});

test('el segundo mensaje ve el primero como contexto', () => {
  const primero = turno(null, 'busco depto en Nueva Córdoba', { barrio: 'Nueva Córdoba' }, AHORA);
  const segundo = turno(primero.fila, 'algo de un dormitorio', { dormitorios: 1 }, AHORA + 60_000);

  assert.match(segundo.contexto, /busco depto en Nueva Córdoba/);
  assert.match(segundo.contexto, /barrio: Nueva Córdoba/);
});

test('el contexto no repite el mensaje actual', () => {
  const primero = turno(null, 'hola', {}, AHORA);
  const segundo = turno(primero.fila, 'busco depto', {}, AHORA + 1000);

  assert.match(segundo.contexto, /hola/);
  assert.ok(!/1\. "busco depto"/.test(segundo.contexto), 'el mensaje actual no va en el historial');
});

test('olvida la conversación tras el TTL de inactividad', () => {
  const primero = turno(null, 'busco depto en Nueva Córdoba', { barrio: 'Nueva Córdoba' }, AHORA);

  const dentro = turno(primero.fila, 'algo más', {}, AHORA + TTL_INACTIVIDAD_MS - 1000);
  assert.strictEqual(dentro.conversacion.entidades.barrio, 'Nueva Córdoba');

  const fuera = turno(primero.fila, 'algo más', {}, AHORA + TTL_INACTIVIDAD_MS + 1000);
  assert.strictEqual(fuera.conversacion.entidades.barrio, null);
  assert.strictEqual(fuera.contexto, '');
});

test('cada mensaje nuevo renueva el TTL', () => {
  let fila = turno(null, 'uno', { barrio: 'Alberdi' }, AHORA).fila;
  let t = AHORA;

  // Cinco mensajes, cada uno casi al borde del TTL.
  for (let i = 0; i < 5; i += 1) {
    t += TTL_INACTIVIDAD_MS - 1000;
    fila = turno(fila, `mensaje ${i}`, {}, t).fila;
  }

  const ultima = conversacionActiva(fila, t);
  assert.strictEqual(ultima.entidades.barrio, 'Alberdi');
});

test('guarda solo los últimos N mensajes', () => {
  let fila = null;
  for (let i = 1; i <= MAX_MENSAJES + 3; i += 1) {
    fila = turno(fila, `mensaje ${i}`, {}, AHORA + i * 1000).fila;
  }

  const conversacion = conversacionActiva(fila, AHORA + 100_000);

  assert.strictEqual(conversacion.mensajes.length, MAX_MENSAJES);
  assert.strictEqual(conversacion.mensajes.at(-1).texto, `mensaje ${MAX_MENSAJES + 3}`);
});

test('un dato nuevo pisa al anterior: el cliente cambió de idea', () => {
  assert.strictEqual(combinarEntidades({ barrio: 'Nueva Córdoba' }, { barrio: 'Alberdi' }).barrio, 'Alberdi');
});

test('un dato ausente no borra el anterior', () => {
  const resultado = combinarEntidades({ barrio: 'Nueva Córdoba', dormitorios: 2 }, { dormitorios: 1 });

  assert.strictEqual(resultado.barrio, 'Nueva Córdoba');
  assert.strictEqual(resultado.dormitorios, 1);
});

test('ignora claves que el modelo se haya inventado', () => {
  const resultado = combinarEntidades({}, { barrio: 'Alberdi', intencion_rara: 'algo' });

  assert.strictEqual(resultado.barrio, 'Alberdi');
  assert.ok(!('intencion_rara' in resultado));
});

test('el 0 cuenta como valor válido', () => {
  assert.strictEqual(combinarEntidades({ dormitorios: 3 }, { dormitorios: 0 }).dormitorios, 0);
});

test('no guarda mensajes vacíos, pero sí sus entidades', () => {
  const { conversacion } = turno(null, '   ', { barrio: 'Alberdi' }, AHORA);

  assert.strictEqual(conversacion.mensajes.length, 0);
  assert.strictEqual(conversacion.entidades.barrio, 'Alberdi');
});

test('el estado sobrevive al ida y vuelta por la Data Table', () => {
  const original = turno(null, 'busco casa en Alberdi', { tipo: 'casa', barrio: 'Alberdi' }, AHORA).conversacion;

  const recuperada = parseEstado(serializarEstado(original));

  assert.deepStrictEqual(recuperada.mensajes, original.mensajes);
  assert.strictEqual(recuperada.entidades.barrio, 'Alberdi');
  assert.strictEqual(recuperada.actualizadoEn, original.actualizadoEn);
});

test('acepta la columna ya parseada como objeto', () => {
  const original = turno(null, 'hola', { barrio: 'Alberdi' }, AHORA).conversacion;

  assert.strictEqual(parseEstado(original).entidades.barrio, 'Alberdi');
});

test('una fila corrupta o vacía no rompe el flujo', () => {
  for (const basura of [null, undefined, '', 'no soy json', '{"roto":', 42, [], { mensajes: 'no es array' }]) {
    assert.doesNotThrow(() => parseEstado(basura), `falló con ${JSON.stringify(basura)}`);
    const conversacion = parseEstado(basura);
    assert.ok(Array.isArray(conversacion.mensajes));
    assert.strictEqual(typeof conversacion.entidades, 'object');
  }
});

test('una conversación sin fecha nunca se considera vigente', () => {
  assert.strictEqual(estaVigente(null, AHORA), false);
  assert.strictEqual(estaVigente({ mensajes: [], entidades: {} }, AHORA), false);
});

test('conversacionActiva devuelve algo usable aunque no haya fila', () => {
  const vacia = conversacionActiva(null, AHORA);

  assert.deepStrictEqual(vacia.mensajes, []);
  assert.deepStrictEqual(vacia.entidades, {});
  assert.strictEqual(formatearContexto(vacia, 'hola'), '');
});

const MOSTRADAS = [
  { id: 'INM-106', barrio: 'Alto Alegre', ciudad: 'Río Tercero' },
  { id: 'INM-104', barrio: 'Barrio Norte', ciudad: 'Río Tercero' },
  { id: 'INM-101', barrio: 'Las Flores', ciudad: 'Río Tercero' },
];

test('el prompt incluye las propiedades que ya se mostraron', () => {
  // El bug que arregla: la memoria guarda lo que escribe el cliente, no lo que
  // contesta el bot. Sin esta lista, "el de Las Flores" no tiene contra qué
  // resolverse y el modelo devuelve null — el cliente eligió y el agente le
  // vuelve a preguntar cuál.
  const conLista = recordarPropiedadesMostradas(
    conversacionActiva(turno(null, 'busco en Río Tercero', {}, AHORA).fila, AHORA),
    MOSTRADAS,
  );
  const contexto = formatearContexto(conLista, 'el de las flores');

  assert.match(contexto, /ya le mostraste/i);
  assert.match(contexto, /1\. INM-106 — Alto Alegre/);
  assert.match(contexto, /3\. INM-101 — Las Flores/, 'el orden importa para "el primero"');
});

test('las propiedades mostradas sobreviven al guardado', () => {
  const guardado = serializarEstado(recordarPropiedadesMostradas(conversacionActiva(null, AHORA), MOSTRADAS));

  assert.deepStrictEqual(parseEstado(guardado).mostradas, MOSTRADAS);
});

test('una búsqueda sin resultados no borra lo que el cliente ya vio', () => {
  // El cliente puede seguir refiriéndose a la última tanda que sí le sirvió.
  const conLista = recordarPropiedadesMostradas(conversacionActiva(null, AHORA), MOSTRADAS);

  assert.deepStrictEqual(recordarPropiedadesMostradas(conLista, []).mostradas, MOSTRADAS);
  assert.deepStrictEqual(recordarPropiedadesMostradas(conLista, null).mostradas, MOSTRADAS);
});

test('solo se recuerda la última tanda, no el historial entero', () => {
  // Si se acumularan, "el primero" apuntaría a una búsqueda vieja.
  const primera = recordarPropiedadesMostradas(conversacionActiva(null, AHORA), MOSTRADAS);
  const segunda = recordarPropiedadesMostradas(primera, [{ id: 'INM-002', barrio: 'Nueva Córdoba' }]);

  assert.strictEqual(segunda.mostradas.length, 1);
  assert.strictEqual(segunda.mostradas[0].id, 'INM-002');
});

test('la lista sobrevive a los mensajes que vienen después', () => {
  // El bug: agregarMensaje y fusionarEntidades armaban el estado nuevo campo
  // por campo, así que se comían todo lo que no enumeraban. La lista duraba
  // hasta el mensaje siguiente y desaparecía justo cuando el cliente decía
  // "el de Las Flores" — que es el único momento en que hace falta.
  let estado = recordarPropiedadesMostradas(conversacionActiva(null, AHORA), MOSTRADAS);

  estado = agregarMensaje(estado, { mensaje: 'me interesa el de las flores' }, AHORA + 1000);
  assert.deepStrictEqual(estado.mostradas, MOSTRADAS, 'agregarMensaje no puede perderla');

  estado = fusionarEntidades(estado, { referencia_propiedad: 'INM-101' }, AHORA + 1000);
  assert.deepStrictEqual(estado.mostradas, MOSTRADAS, 'fusionarEntidades tampoco');

  assert.match(formatearContexto(estado, 'otra cosa'), /INM-101/);
});

test('una fila vieja sin la lista de mostradas se lee igual', () => {
  // Compatibilidad hacia atrás: las filas escritas antes de este cambio no
  // tienen el campo, y no pueden romper la lectura.
  const vieja = JSON.stringify({ mensajes: [{ texto: 'hola' }], entidades: {}, actualizadoEn: AHORA });

  assert.deepStrictEqual(parseEstado(vieja).mostradas, []);
});

test('las entidades sin valor no ensucian el prompt', () => {
  const primero = turno(null, 'busco depto', { barrio: 'Alberdi' }, AHORA);
  const segundo = turno(primero.fila, 'de dos dormitorios', {}, AHORA + 1000);

  assert.match(segundo.contexto, /barrio: Alberdi/);
  assert.ok(!/presupuesto/.test(segundo.contexto));
  assert.ok(!/null/.test(segundo.contexto));
});

test('fusionarEntidades no pierde el historial', () => {
  const conMensaje = agregarMensaje(null, { mensaje: 'hola' }, AHORA);
  const final = fusionarEntidades(conMensaje, { barrio: 'Alberdi' }, AHORA);

  assert.strictEqual(final.mensajes.length, 1);
  assert.strictEqual(final.entidades.barrio, 'Alberdi');
});

test('la transcripción reemplaza al marcador de la nota de voz', () => {
  // Así funciona con audio: primero se guarda un marcador (antes de llamar al
  // modelo), y cuando vuelve la transcripción se corrige el historial.
  const conMarcador = agregarMensaje(null, { mensaje: '(nota de voz)' }, AHORA);
  const corregida = reemplazarUltimoMensaje(conMarcador, 'busco depto en Nueva Córdoba');

  assert.strictEqual(corregida.mensajes.length, 1);
  assert.strictEqual(corregida.mensajes[0].texto, 'busco depto en Nueva Córdoba');
});

test('reemplazar solo toca el último mensaje, no el historial previo', () => {
  let conversacion = agregarMensaje(null, { mensaje: 'hola' }, AHORA);
  conversacion = agregarMensaje(conversacion, { mensaje: '(nota de voz)' }, AHORA + 1000);

  const corregida = reemplazarUltimoMensaje(conversacion, 'quiero ver el depto');

  assert.deepStrictEqual(
    corregida.mensajes.map((m) => m.texto),
    ['hola', 'quiero ver el depto'],
  );
});

test('reemplazar no rompe si no hay nada que reemplazar', () => {
  assert.doesNotThrow(() => reemplazarUltimoMensaje(null, 'algo'));
  assert.deepStrictEqual(reemplazarUltimoMensaje({ mensajes: [] }, 'algo').mensajes, []);

  // Sin texto nuevo, el historial queda como estaba.
  const original = agregarMensaje(null, { mensaje: '(nota de voz)' }, AHORA);
  assert.strictEqual(reemplazarUltimoMensaje(original, '').mensajes[0].texto, '(nota de voz)');
});
