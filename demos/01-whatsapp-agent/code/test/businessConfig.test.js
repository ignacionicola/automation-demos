const test = require('node:test');
const assert = require('node:assert');

const {
  NEGOCIO_POR_DEFECTO,
  parsearNegocio,
  parsearFaq,
  describirHorarios,
  resolverPlaceholders,
} = require('../src/businessConfig');
const { parseVisitRequest, formatSchedulingReply, buildVisitRecord } = require('../src/scheduling');

const filas = (mapa) => Object.entries(mapa).map(([clave, valor]) => ({ clave, valor }));

test('la pestaña negocio se lee como clave/valor', () => {
  const negocio = parsearNegocio(
    filas({
      nombre: 'Inmobiliaria Nicola',
      direccion: 'San Martín 450, Río Tercero',
      telefono: '+54 3571 41-2233',
      hora_apertura: '8',
      hora_cierre: '20',
      hora_cierre_sabado: '12',
    }),
  );

  assert.strictEqual(negocio.nombre, 'Inmobiliaria Nicola');
  assert.strictEqual(negocio.horaApertura, 8);
  assert.strictEqual(negocio.horaCierre, 20);
  assert.strictEqual(negocio.horaCierreSabado, 12);
});

test('lo que la planilla no diga usa el default, no queda vacío', () => {
  // La demo tiene que andar antes de que exista ninguna planilla, y una
  // planilla a medio llenar no puede dejar al bot sin horario.
  const negocio = parsearNegocio(filas({ nombre: 'Solo el nombre' }));

  assert.strictEqual(negocio.nombre, 'Solo el nombre');
  assert.strictEqual(negocio.horaApertura, NEGOCIO_POR_DEFECTO.horaApertura);
  assert.strictEqual(negocio.horaCierre, NEGOCIO_POR_DEFECTO.horaCierre);
  assert.deepStrictEqual(parsearNegocio([]), NEGOCIO_POR_DEFECTO);
  assert.deepStrictEqual(parsearNegocio(null), NEGOCIO_POR_DEFECTO);
});

test('los nombres de las claves admiten variantes y tildes', () => {
  const negocio = parsearNegocio([
    { campo: 'Dirección', valor: 'Colón 1250' },
    { campo: 'abre', valor: '10' },
    { campo: 'cierra', valor: '18' },
  ]);

  assert.strictEqual(negocio.direccion, 'Colón 1250');
  assert.strictEqual(negocio.horaApertura, 10);
  assert.strictEqual(negocio.horaCierre, 18);
});

test('se puede cerrar los sábados', () => {
  const negocio = parsearNegocio(filas({ hora_cierre_sabado: 'cerrado' }));

  assert.strictEqual(negocio.horaCierreSabado, null);
  assert.strictEqual(describirHorarios(negocio), '*lunes a viernes de 9 a 19 hs*');
  assert.ok(!/sábado/.test(describirHorarios(negocio)));
});

test('un horario imposible no deja a la agencia sin horario', () => {
  // Si el cierre quedara antes de la apertura, el bot rechazaría todos los
  // turnos sin poder explicar por qué.
  const negocio = parsearNegocio(filas({ hora_apertura: '18', hora_cierre: '9' }));

  assert.strictEqual(negocio.horaCierre, NEGOCIO_POR_DEFECTO.horaCierre);
});

test('el horario de la planilla valida los turnos, no solo el texto', () => {
  // Este es el punto de todo el cambio. Antes el horario estaba en seis
  // lugares: si la inmobiliaria ponía "9 a 20", la FAQ lo decía y el bot
  // igual rechazaba las 19:30.
  const negocio = parsearNegocio(filas({ hora_apertura: '8', hora_cierre: '20' }));
  const ahora = new Date(2026, 7, 3, 10, 0);
  const pedir = (hora) =>
    parseVisitRequest(
      { fecha_visita: '2026-08-05', hora_visita: hora, referencia_propiedad: 'INM-1' },
      { ahora, negocio },
    );

  assert.strictEqual(pedir('19:30').valido, true, 'con cierre a las 20, las 19:30 entran');
  assert.strictEqual(pedir('08:30').valido, true, 'con apertura a las 8, las 8:30 entran');
  assert.strictEqual(pedir('20:30').motivo, 'fuera_de_horario');
  assert.strictEqual(pedir('07:00').motivo, 'fuera_de_horario');

  // Y con los defaults, lo de siempre.
  assert.strictEqual(
    parseVisitRequest({ fecha_visita: '2026-08-05', hora_visita: '19:30' }, { ahora }).motivo,
    'fuera_de_horario',
  );
});

test('el mensaje al cliente cuenta el horario de su planilla', () => {
  const negocio = parsearNegocio(filas({ hora_apertura: '8', hora_cierre: '20', hora_cierre_sabado: 'cerrado' }));
  const validacion = parseVisitRequest({}, { ahora: new Date(2026, 7, 3, 10, 0), negocio });
  const mensaje = formatSchedulingReply(validacion, buildVisitRecord(validacion, null, {}), { negocio });

  assert.match(mensaje, /de 8 a 20 hs/);
  assert.ok(!/9 a 19/.test(mensaje), 'no puede quedar el horario viejo hardcodeado');
});

test('un sábado cerrado se explica como sábado, no como domingo', () => {
  // 2026-08-08 es sábado.
  const negocio = parsearNegocio(filas({ hora_cierre_sabado: 'cerrado' }));
  const validacion = parseVisitRequest(
    { fecha_visita: '2026-08-08', hora_visita: '11:00' },
    { ahora: new Date(2026, 7, 3, 10, 0), negocio },
  );

  assert.strictEqual(validacion.motivo, 'dia_cerrado');
  const mensaje = formatSchedulingReply(validacion, buildVisitRecord(validacion, null, {}), { negocio });
  assert.match(mensaje, /sábados no atendemos/i);
});

test('los placeholders se completan desde la pestaña negocio', () => {
  const negocio = parsearNegocio(filas({ nombre: 'Nicola', direccion: 'San Martín 450', telefono: '3571-41' }));

  assert.strictEqual(resolverPlaceholders('Estamos en {{direccion}}.', negocio), 'Estamos en San Martín 450.');
  assert.match(resolverPlaceholders('Atendemos de {{horarios}}.', negocio), /lunes a viernes de 9 a 19 hs/);
  assert.strictEqual(resolverPlaceholders('Llamá al {{ telefono }}', negocio), 'Llamá al 3571-41');
});

test('un placeholder mal escrito se ve, no deja un hueco', () => {
  // Un hueco en blanco no le dice a nadie que se equivocó; el texto tal cual
  // aparece en el chat y se corrige.
  assert.strictEqual(resolverPlaceholders('Hola {{horario}}', {}), 'Hola {{horario}}');
  assert.strictEqual(resolverPlaceholders(null, {}), '');
});

test('la pestaña faq se lee con sus palabras clave', () => {
  const entradas = parsearFaq([
    { id: 'faq-comision', pregunta: '¿Cuánto cobran?', claves: 'comision, honorarios', respuesta: 'Un mes.' },
    { id: 'sin-respuesta', pregunta: 'algo', claves: 'x', respuesta: '' },
    { id: '', respuesta: 'huérfana' },
  ]);

  assert.strictEqual(entradas.length, 1, 'una entrada sin respuesta solo sirve para contestar en silencio');
  assert.deepStrictEqual(entradas[0].claves, ['comision', 'honorarios']);
  assert.strictEqual(entradas[0].respuesta, 'Un mes.');
});
