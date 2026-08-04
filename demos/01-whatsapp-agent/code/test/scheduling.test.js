const test = require('node:test');
const assert = require('node:assert');

const {
  parseVisitRequest,
  marcarHorarioOcupado,
  buildVisitRecord,
  formatSchedulingReply,
} = require('../src/scheduling');

// Referencia fija para que los tests no dependan del día en que corren.
// 2026-08-03 es un lunes.
const AHORA = new Date(2026, 7, 3, 10, 0);

const opciones = { ahora: AHORA };

// Una visita completa: miércoles a las 16, propiedad elegida y mail. Los tests
// que prueban un rechazo le sacan justo el dato que están probando.
const VISITA = {
  fecha_visita: '2026-08-05',
  hora_visita: '16:00',
  referencia_propiedad: 'INM-002',
  email: 'lucia@example.com',
};

test('acepta una visita válida en día hábil', () => {
  const resultado = parseVisitRequest(VISITA, opciones);

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
    parseVisitRequest({ ...VISITA, fecha_visita: '2026-08-08', hora_visita: '11:00' }, opciones).valido,
    true,
  );
  assert.strictEqual(
    parseVisitRequest({ ...VISITA, fecha_visita: '2026-08-08', hora_visita: '15:00' }, opciones).motivo,
    'fuera_de_horario',
  );
});

test('el mail no hace falta para agendar', () => {
  // El cliente ya recibe su confirmación por WhatsApp. Pedirle el mail agrega
  // un ida y vuelta para darle algo que ya tiene, y bloquear la reserva por no
  // tenerlo sería lo peor de los dos mundos.
  for (const email of [null, undefined, '', 'no-es-un-mail']) {
    const resultado = parseVisitRequest({ ...VISITA, email }, opciones);
    assert.strictEqual(resultado.valido, true, `con email=${JSON.stringify(email)} debería agendar igual`);
  }
});

test('se pregunta qué propiedad visitar cuando no se sabe cuál', () => {
  // Sin esto el dueño recibe un turno sin saber qué mostrar ni adónde ir.
  const resultado = parseVisitRequest({ ...VISITA, referencia_propiedad: null }, opciones);

  assert.strictEqual(resultado.valido, false);
  assert.strictEqual(resultado.motivo, 'falta_propiedad');
  assert.deepStrictEqual(resultado.faltante, ['propiedad']);
  // La fecha ya validada sigue disponible: el mensaje la confirma mientras pregunta.
  assert.strictEqual(resultado.cuando.getHours(), 16);
});

test('la propiedad se pregunta recién cuando el horario ya sirve', () => {
  // No tiene sentido preguntar qué quiere ver para un turno que se rechaza igual.
  const domingo = parseVisitRequest(
    { fecha_visita: '2026-08-09', hora_visita: '11:00', referencia_propiedad: null },
    opciones,
  );

  assert.strictEqual(domingo.motivo, 'domingo_cerrado');
});

test('si no vino ni la fecha ni la propiedad, se piden juntas', () => {
  // Encadenar preguntas de a una cansa, y son dos datos que el cliente tiene
  // igual de a mano.
  const resultado = parseVisitRequest({}, opciones);

  assert.strictEqual(resultado.motivo, 'datos_incompletos');
  assert.strictEqual(resultado.sinPropiedad, true);

  const mensaje = formatSchedulingReply(resultado, buildVisitRecord(resultado, null, {}), {});
  assert.match(mensaje, /qué día y a qué hora/i);
  assert.match(mensaje, /propiedad/i);
});

test('buildVisitRecord arma la fila del registro', () => {
  const validacion = parseVisitRequest(VISITA, opciones);
  const registro = buildVisitRecord(validacion, { telefono: '+5493511234567', nombre: 'Lucía' }, {
    ...VISITA,
    referencia_propiedad: 'INM-002',
  });

  assert.strictEqual(registro.telefono, '+5493511234567');
  assert.strictEqual(registro.nombre, 'Lucía');
  assert.strictEqual(registro.email, 'lucia@example.com');
  assert.strictEqual(registro.propiedad, 'INM-002');
  assert.strictEqual(registro.horaLegible, '16:00');
  assert.match(registro.fechaLegible, /miércoles 5 de agosto/);
  assert.strictEqual(registro.estado, 'pendiente_de_confirmacion');
});

test('la fecha guardada lleva el offset argentino, no UTC', () => {
  // La fila, el evento de Calendar y el mensaje al cliente tienen que decir la
  // misma hora. En UTC, un toISOString() convertiría las 16:00 en "19:00Z" y
  // la fila diría una hora que nadie acordó.
  const validacion = parseVisitRequest(VISITA, opciones);
  const registro = buildVisitRecord(validacion, null, VISITA);

  assert.strictEqual(registro.fechaIso, '2026-08-05T16:00:00-03:00');
});

test('buildVisitRecord usa valores por defecto si falta el contacto', () => {
  const validacion = parseVisitRequest({ fecha_visita: '2026-08-05', hora_visita: '16:00' }, opciones);
  const registro = buildVisitRecord(validacion, null, null);

  assert.strictEqual(registro.nombre, 'Sin nombre');
  assert.strictEqual(registro.propiedad, 'A definir');
});

/** Una visita válida con su fila, que es lo que recibe formatSchedulingReply. */
function visitaConfirmada(entidades) {
  const datos = { ...VISITA, referencia_propiedad: 'INM-002', ...entidades };
  const validacion = parseVisitRequest(datos, opciones);
  return { validacion, registro: buildVisitRecord(validacion, { telefono: '+549351', nombre: 'Lucía' }, datos) };
}

test('confirma la visita en el mensaje al cliente', () => {
  const { validacion, registro } = visitaConfirmada();
  const mensaje = formatSchedulingReply(validacion, registro, {
    agencia: 'Inmobiliaria Demo',
    calendario: { creado: true },
  });

  assert.match(mensaje, /INM-002/);
  assert.match(mensaje, /miércoles 5 de agosto/);
  assert.match(mensaje, /16:00/);
  assert.match(mensaje, /Inmobiliaria Demo/);
  assert.match(mensaje, /lucia@example\.com/, 'tiene que decir a dónde fue la invitación');
});

test('sin Calendar no se promete una invitación que no salió', () => {
  // Si la llamada a Calendar falló, el cliente no puede quedarse esperando un
  // mail que nunca va a llegar: la visita queda registrada igual y lo confirma
  // una persona.
  const { validacion, registro } = visitaConfirmada();
  const mensaje = formatSchedulingReply(validacion, registro, {
    agencia: 'Inmobiliaria Demo',
    calendario: { creado: false, error: 'invalid_grant' },
  });

  assert.ok(!/invitaci[óo]n/i.test(mensaje), 'no debe prometer la invitación');
  assert.ok(!/invalid_grant/.test(mensaje), 'el error técnico no le sirve al cliente');
  assert.match(mensaje, /asesor/i);
  assert.match(mensaje, /miércoles 5 de agosto/, 'la visita igual quedó anotada');
});

test('al preguntar qué propiedad, ofrece mostrar el catálogo', () => {
  // El cliente puede no haber elegido todavía. Una pregunta cerrada lo deja
  // sin salida; ofrecerle ver las opciones lo lleva a la búsqueda, que es de
  // lo que vino a hablar.
  const { validacion, registro } = visitaConfirmada({ referencia_propiedad: null });
  const mensaje = formatSchedulingReply(validacion, registro, {});

  assert.match(mensaje, /qué propiedad/i);
  assert.match(mensaje, /te muestro/i, 'tiene que ofrecer la otra salida');
  assert.match(mensaje, /miércoles 5 de agosto/, 'confirma el horario que ya se habló');
  assert.match(mensaje, /16:00/);
});

test('sin mail confirma igual, sin prometer una invitación', () => {
  const { validacion, registro } = visitaConfirmada({ email: null });
  const mensaje = formatSchedulingReply(validacion, registro, {
    agencia: 'Inmobiliaria Demo',
    calendario: { creado: true },
  });

  assert.match(mensaje, /agendada/i);
  assert.match(mensaje, /miércoles 5 de agosto/);
  assert.ok(!/invitaci[óo]n/i.test(mensaje), 'no hay a quién mandársela');
  // Tampoco se lo pide después: el cliente contestaría con la dirección y ese
  // mensaje, con la fecha todavía en memoria, agendaría una segunda visita.
  assert.ok(!/mail|correo/i.test(mensaje), 'no puede pedir el mail después de agendar');
});

test('cuando el horario está tomado ofrece los libres más cercanos', () => {
  const { validacion, registro } = visitaConfirmada();
  const ocupado = marcarHorarioOcupado(validacion, ['15:00', '17:30']);

  assert.strictEqual(ocupado.valido, false);
  assert.strictEqual(ocupado.motivo, 'horario_ocupado');

  const mensaje = formatSchedulingReply(ocupado, registro, {});
  assert.match(mensaje, /tomado/i);
  assert.match(mensaje, /15:00/);
  assert.match(mensaje, /17:30/);
  assert.ok(!/¡Listo!/.test(mensaje), 'no puede sonar a confirmación');
});

test('si no queda ningún hueco ese día, propone cambiar de día', () => {
  const { validacion, registro } = visitaConfirmada();
  const mensaje = formatSchedulingReply(marcarHorarioOcupado(validacion, []), registro, {});

  assert.match(mensaje, /otro d[íi]a/i);
  assert.match(mensaje, /9 a 19/, 'le recuerda el horario de atención');
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
