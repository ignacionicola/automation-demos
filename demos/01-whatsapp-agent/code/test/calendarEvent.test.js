const test = require('node:test');
const assert = require('node:assert');

const {
  esEmailValido,
  normalizarEmail,
  bloquesOcupados,
  seSolapa,
  buscarAlternativas,
  formatearAlternativas,
  buildCalendarEvent,
  DURACION_VISITA_MINUTOS,
} = require('../src/calendarEvent');
const { aHoraIso } = require('../src/localTime');

// Miércoles 5 de agosto de 2026, 16:00, hora de Córdoba.
const CUANDO = new Date(2026, 7, 5, 16, 0);
const MANIANA_TEMPRANO = new Date(2026, 7, 5, 8, 0);

const REGISTRO = {
  telefono: '+5493511234567',
  nombre: 'Lucía',
  email: 'lucia@example.com',
  propiedad: 'INM-002',
  fechaLegible: 'miércoles 5 de agosto',
  horaLegible: '16:00',
};

const PROPIEDAD = {
  id: 'INM-002',
  tipo: 'departamento',
  barrio: 'Nueva Córdoba',
  ciudad: 'Córdoba',
  direccion: 'Independencia 850',
};

/** Bloque ocupado del día, en horas de pared argentinas. */
function ocupado(desdeHora, desdeMin, hastaHora, hastaMin) {
  const iso = (h, m) => `2026-08-05T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-03:00`;
  return { start: iso(desdeHora, desdeMin), end: iso(hastaHora, hastaMin) };
}

test('reconoce lo que tiene forma de mail y lo que no', () => {
  assert.ok(esEmailValido('lucia@example.com'));
  assert.ok(esEmailValido('  Lucia.Perez+visitas@sub.example.com.ar  '));

  for (const invalido of ['lucia', 'lucia@', '@example.com', 'lucia@example', '', null, 42]) {
    assert.ok(!esEmailValido(invalido), `"${invalido}" no debería pasar`);
  }
});

test('normalizarEmail limpia y devuelve null si no sirve', () => {
  assert.strictEqual(normalizarEmail('  Lucia@Example.COM '), 'lucia@example.com');
  assert.strictEqual(normalizarEmail('lucia'), null);
});

test('bloquesOcupados descarta lo que no trae las dos fechas', () => {
  // Cuando Calendar falla, el nodo emite { error }: no puede colarse como un
  // bloque válido ni tumbar el parseo del resto.
  const bloques = bloquesOcupados([
    ocupado(16, 0, 17, 0),
    { error: 'invalid_grant' },
    { start: '2026-08-05T10:00:00-03:00' },
    null,
  ]);

  assert.strictEqual(bloques.length, 1);
});

test('dos visitas consecutivas no cuentan como superpuestas', () => {
  const bloques = bloquesOcupados([ocupado(15, 0, 15, 45)]);

  // La de las 15:45 empieza justo cuando termina la anterior.
  assert.ok(!seSolapa(bloques, new Date(2026, 7, 5, 15, 45), new Date(2026, 7, 5, 16, 30)));
  // Esta sí la pisa por 15 minutos.
  assert.ok(seSolapa(bloques, new Date(2026, 7, 5, 15, 30), new Date(2026, 7, 5, 16, 15)));
});

test('las alternativas evitan lo ocupado y salen ordenadas', () => {
  const bloques = bloquesOcupados([ocupado(16, 0, 17, 0)]);
  const horas = formatearAlternativas(
    buscarAlternativas(bloques, CUANDO, { apertura: 9, cierre: 19, ahora: MANIANA_TEMPRANO }),
  );

  assert.strictEqual(horas.length, 3);
  assert.deepStrictEqual(horas, [...horas].sort(), 'se muestran de menor a mayor');

  // 15:30 terminaría 16:15, adentro del bloque ocupado.
  assert.ok(!horas.includes('15:30'));
  assert.ok(!horas.includes('16:00'), 'no puede reofrecer el horario que está tomado');
  // 17:00 arranca justo cuando se libera, y 15:00 termina antes de que se ocupe.
  assert.ok(horas.includes('17:00'));
  assert.ok(horas.includes('15:00'));
});

test('prioriza los horarios más cercanos al que pidió el cliente', () => {
  const horas = formatearAlternativas(
    buscarAlternativas(bloquesOcupados([ocupado(16, 0, 17, 0)]), CUANDO, {
      apertura: 9,
      cierre: 19,
      ahora: MANIANA_TEMPRANO,
      maximo: 2,
    }),
  );

  // Pidió las 16: 15:00 y 17:00 son lo más cerca que hay, no las 9 de la mañana.
  assert.deepStrictEqual(horas, ['15:00', '17:00']);
});

test('no ofrece horarios que ya pasaron', () => {
  const horas = formatearAlternativas(
    buscarAlternativas(bloquesOcupados([ocupado(17, 0, 18, 0)]), new Date(2026, 7, 5, 17, 0), {
      apertura: 9,
      cierre: 19,
      ahora: new Date(2026, 7, 5, 16, 30),
    }),
  );

  assert.ok(horas.length > 0);
  for (const hora of horas) assert.ok(hora > '16:30', `${hora} ya pasó`);
});

test('la visita tiene que terminar antes de cerrar, no solo empezar', () => {
  const horas = formatearAlternativas(
    buscarAlternativas([], CUANDO, { apertura: 9, cierre: 19, ahora: MANIANA_TEMPRANO, maximo: 50 }),
  );

  // Con 45 minutos de visita, 18:30 se pasaría de las 19.
  assert.strictEqual(horas[horas.length - 1], '18:00');

  const sabado = formatearAlternativas(
    buscarAlternativas([], new Date(2026, 7, 8, 11, 0), {
      apertura: 9,
      cierre: 13,
      ahora: new Date(2026, 7, 8, 8, 0),
      maximo: 50,
    }),
  );
  assert.strictEqual(sabado[sabado.length - 1], '12:00');
});

test('si el día está completo no inventa alternativas', () => {
  const horas = buscarAlternativas(bloquesOcupados([ocupado(0, 0, 23, 59)]), CUANDO, {
    apertura: 9,
    cierre: 19,
    ahora: MANIANA_TEMPRANO,
  });

  assert.deepStrictEqual(horas, []);
});

test('el evento lleva la hora con offset argentino y la duración de una visita', () => {
  const evento = buildCalendarEvent(CUANDO, REGISTRO, { agencia: 'Inmobiliaria Demo' });

  assert.strictEqual(evento.inicio, '2026-08-05T16:00:00-03:00');
  assert.strictEqual(evento.fin, '2026-08-05T16:45:00-03:00');
  assert.strictEqual(evento.duracionMinutos, DURACION_VISITA_MINUTOS);
  assert.strictEqual(evento.zonaHoraria, 'America/Argentina/Buenos_Aires');
});

test('el cliente va como invitado: es lo que dispara el mail de Google', () => {
  const evento = buildCalendarEvent(CUANDO, REGISTRO, {});

  assert.deepStrictEqual(evento.invitados, ['lucia@example.com']);
});

test('sin mail válido no se inventa un invitado', () => {
  const evento = buildCalendarEvent(CUANDO, { ...REGISTRO, email: 'lucia' }, {});

  assert.deepStrictEqual(evento.invitados, []);
  assert.match(evento.descripcion, /no lo dejó/);
});

test('el evento le dice al asesor con quién y dónde', () => {
  const evento = buildCalendarEvent(CUANDO, REGISTRO, {
    propiedad: PROPIEDAD,
    agencia: 'Inmobiliaria Demo',
  });

  assert.match(evento.resumen, /INM-002/);
  assert.match(evento.descripcion, /Lucía/);
  assert.match(evento.descripcion, /\+5493511234567/, 'el teléfono, para poder llamarlo');
  assert.strictEqual(evento.ubicacion, 'Independencia 850, Nueva Córdoba, Córdoba');
});

test('sin propiedad identificada el evento igual sirve', () => {
  const evento = buildCalendarEvent(CUANDO, { ...REGISTRO, propiedad: 'A definir' }, {});

  assert.match(evento.resumen, /a definir/i);
  assert.strictEqual(evento.ubicacion, '', 'sin dirección inventada');
});

test('la ventana de consulta cubre el día entero', () => {
  // Recortarla al horario de atención escondería una visita cargada a mano
  // fuera de hora, que igual le ocupa el tiempo al asesor.
  const evento = buildCalendarEvent(CUANDO, REGISTRO, {});

  assert.strictEqual(evento.ventanaDia.desde, '2026-08-05T00:00:00-03:00');
  assert.strictEqual(evento.ventanaDia.hasta, '2026-08-06T00:00:00-03:00');
});

test('una fecha inválida no arma ningún evento', () => {
  assert.strictEqual(buildCalendarEvent(new Date('x'), REGISTRO, {}), null);
  assert.strictEqual(buildCalendarEvent(null, REGISTRO, {}), null);
});

test('formatearAlternativas escribe horas, no fechas completas', () => {
  assert.deepStrictEqual(formatearAlternativas([new Date(2026, 7, 5, 9, 30)]), ['09:30']);
  assert.strictEqual(aHoraIso(new Date(2026, 7, 5, 9, 30)), '09:30');
  assert.deepStrictEqual(formatearAlternativas(null), []);
});
