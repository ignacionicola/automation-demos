const test = require('node:test');
const assert = require('node:assert');

const { parseVisitRequest, buildVisitRecord, formatSchedulingReply } = require('../src/scheduling');

// Referencia fija para que los tests no dependan del día en que corren.
// 2026-08-03 es un lunes.
const AHORA = new Date(2026, 7, 3, 10, 0);

const opciones = { ahora: AHORA };

test('acepta una visita válida en día hábil', () => {
  const resultado = parseVisitRequest({ fecha_visita: '2026-08-05', hora_visita: '16:00' }, opciones);

  assert.strictEqual(resultado.valido, true);
  assert.strictEqual(resultado.motivo, 'ok');
  assert.strictEqual(resultado.cuando.getHours(), 16);
});

test('pide fecha y hora cuando no vino ninguna', () => {
  const resultado = parseVisitRequest({}, opciones);

  assert.strictEqual(resultado.valido, false);
  assert.strictEqual(resultado.motivo, 'datos_incompletos');
  assert.deepStrictEqual(resultado.faltante, ['fecha', 'hora']);
});

test('pide solo la hora cuando falta únicamente esa', () => {
  const resultado = parseVisitRequest({ fecha_visita: '2026-08-05' }, opciones);

  assert.strictEqual(resultado.motivo, 'datos_incompletos');
  assert.deepStrictEqual(resultado.faltante, ['hora']);
});

test('rechaza fechas inexistentes', () => {
  const resultado = parseVisitRequest({ fecha_visita: '2026-02-31', hora_visita: '10:00' }, opciones);

  assert.strictEqual(resultado.motivo, 'datos_incompletos');
  assert.ok(resultado.faltante.includes('fecha'));
});

test('rechaza formatos de fecha y hora inválidos', () => {
  assert.strictEqual(
    parseVisitRequest({ fecha_visita: '05/08/2026', hora_visita: '16:00' }, opciones).motivo,
    'datos_incompletos',
  );
  assert.strictEqual(
    parseVisitRequest({ fecha_visita: '2026-08-05', hora_visita: '25:00' }, opciones).motivo,
    'datos_incompletos',
  );
});

test('rechaza fechas que ya pasaron', () => {
  const resultado = parseVisitRequest({ fecha_visita: '2026-07-30', hora_visita: '16:00' }, opciones);

  assert.strictEqual(resultado.valido, false);
  assert.strictEqual(resultado.motivo, 'fecha_pasada');
});

test('rechaza los domingos', () => {
  // 2026-08-09 es domingo.
  const resultado = parseVisitRequest({ fecha_visita: '2026-08-09', hora_visita: '11:00' }, opciones);

  assert.strictEqual(resultado.motivo, 'domingo_cerrado');
});

test('rechaza horarios fuera de la atención en día hábil', () => {
  assert.strictEqual(
    parseVisitRequest({ fecha_visita: '2026-08-05', hora_visita: '08:00' }, opciones).motivo,
    'fuera_de_horario',
  );
  assert.strictEqual(
    parseVisitRequest({ fecha_visita: '2026-08-05', hora_visita: '20:00' }, opciones).motivo,
    'fuera_de_horario',
  );
});

test('el sábado cierra a las 13', () => {
  // 2026-08-08 es sábado.
  assert.strictEqual(
    parseVisitRequest({ fecha_visita: '2026-08-08', hora_visita: '11:00' }, opciones).valido,
    true,
  );
  assert.strictEqual(
    parseVisitRequest({ fecha_visita: '2026-08-08', hora_visita: '15:00' }, opciones).motivo,
    'fuera_de_horario',
  );
});

test('buildVisitRecord arma la fila de la planilla', () => {
  const validacion = parseVisitRequest({ fecha_visita: '2026-08-05', hora_visita: '16:00' }, opciones);
  const registro = buildVisitRecord(validacion, { telefono: '+5493511234567', nombre: 'Lucía' }, {
    referencia_propiedad: 'INM-002',
  });

  assert.strictEqual(registro.telefono, '+5493511234567');
  assert.strictEqual(registro.nombre, 'Lucía');
  assert.strictEqual(registro.propiedad, 'INM-002');
  assert.strictEqual(registro.horaLegible, '16:00');
  assert.match(registro.fechaLegible, /miércoles 5 de agosto/);
  assert.strictEqual(registro.estado, 'pendiente_de_confirmacion');
});

test('buildVisitRecord usa valores por defecto si falta el contacto', () => {
  const validacion = parseVisitRequest({ fecha_visita: '2026-08-05', hora_visita: '16:00' }, opciones);
  const registro = buildVisitRecord(validacion, null, null);

  assert.strictEqual(registro.nombre, 'Sin nombre');
  assert.strictEqual(registro.propiedad, 'A definir');
});

test('confirma la visita en el mensaje al cliente', () => {
  const validacion = parseVisitRequest({ fecha_visita: '2026-08-05', hora_visita: '16:00' }, opciones);
  const registro = buildVisitRecord(validacion, { telefono: '+549351', nombre: 'Lucía' }, {
    referencia_propiedad: 'INM-002',
  });
  const mensaje = formatSchedulingReply(validacion, registro, { agencia: 'Inmobiliaria Demo' });

  assert.match(mensaje, /INM-002/);
  assert.match(mensaje, /miércoles 5 de agosto/);
  assert.match(mensaje, /16:00/);
  assert.match(mensaje, /Inmobiliaria Demo/);
});

test('pide los datos que faltan en el mensaje al cliente', () => {
  const validacion = parseVisitRequest({}, opciones);
  const mensaje = formatSchedulingReply(validacion, buildVisitRecord(validacion, null, null), {});

  assert.match(mensaje, /qué día y a qué hora/i);
  assert.match(mensaje, /9 a 19/);
});

test('explica el cierre de los domingos', () => {
  const validacion = parseVisitRequest({ fecha_visita: '2026-08-09', hora_visita: '11:00' }, opciones);
  const mensaje = formatSchedulingReply(validacion, buildVisitRecord(validacion, null, null), {});

  assert.match(mensaje, /domingos no atendemos/i);
});
