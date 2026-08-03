/**
 * La zona horaria es de las cosas que andan perfecto en la máquina donde se
 * escriben y se rompen al desplegar, así que estos tests fuerzan el caso malo:
 * `npm test` corre la suite entera una segunda vez con TZ=UTC (ver
 * package.json), que es la zona del contenedor de deploy/. Todo lo de acá
 * tiene que dar igual en las dos corridas.
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  ahoraEnArgentina,
  aFechaIso,
  aHoraIso,
  aRfc3339,
  deRfc3339,
  aInstante,
  sumarMinutos,
  conHora,
  OFFSET_UTC,
} = require('../src/localTime');

test('ahoraEnArgentina devuelve la hora de pared de Córdoba', () => {
  // 2026-08-05T22:30:00Z son las 19:30 del mismo día en Córdoba.
  const cordoba = ahoraEnArgentina('2026-08-05T22:30:00Z');

  assert.strictEqual(aFechaIso(cordoba), '2026-08-05');
  assert.strictEqual(aHoraIso(cordoba), '19:30');
});

test('después de las 21 argentinas el día todavía no cambió', () => {
  // Este es el bug concreto: a las 00:30 UTC del jueves, en Córdoba son las
  // 21:30 del miércoles. Un `new Date()` en un servidor UTC diría "jueves", y
  // el cliente que escribe "mañana a las 10" terminaría agendado el viernes.
  const cordoba = ahoraEnArgentina('2026-08-06T00:30:00Z');

  assert.strictEqual(aFechaIso(cordoba), '2026-08-05');
  assert.strictEqual(aHoraIso(cordoba), '21:30');
});

test('aRfc3339 escribe el offset argentino explícito', () => {
  assert.strictEqual(aRfc3339(new Date(2026, 7, 5, 16, 0)), `2026-08-05T16:00:00${OFFSET_UTC}`);
  assert.strictEqual(OFFSET_UTC, '-03:00');
});

test('aInstante da el instante real, no la hora del proceso', () => {
  // Las 16:00 de Córdoba son las 19:00 UTC, corra donde corra esto.
  assert.strictEqual(aInstante(new Date(2026, 7, 5, 16, 0)), Date.parse('2026-08-05T19:00:00Z'));
});

test('deRfc3339 vuelve a la hora de pared sin reinterpretar el offset', () => {
  const vuelta = deRfc3339('2026-08-05T16:00:00-03:00');

  assert.strictEqual(vuelta.getHours(), 16, 'tiene que seguir diciendo las 16');
  assert.strictEqual(vuelta.getDate(), 5);
});

test('aRfc3339 y deRfc3339 son inversas', () => {
  const original = new Date(2026, 7, 5, 9, 30);

  assert.strictEqual(deRfc3339(aRfc3339(original)).getTime(), original.getTime());
});

test('sumarMinutos cruza la hora sin perder la fecha', () => {
  assert.strictEqual(aHoraIso(sumarMinutos(new Date(2026, 7, 5, 16, 45), 45)), '17:30');

  const medianoche = sumarMinutos(new Date(2026, 7, 5, 23, 30), 45);
  assert.strictEqual(aFechaIso(medianoche), '2026-08-06');
  assert.strictEqual(aHoraIso(medianoche), '00:15');
});

test('conHora cambia la hora del día sin mover la fecha', () => {
  const inicio = conHora(new Date(2026, 7, 5, 16, 45), 9, 0);

  assert.strictEqual(aFechaIso(inicio), '2026-08-05');
  assert.strictEqual(aHoraIso(inicio), '09:00');
});

test('las fechas inválidas no rompen, devuelven null o Invalid Date', () => {
  assert.strictEqual(aRfc3339(null), null);
  assert.strictEqual(aFechaIso('no es una fecha'), null);
  assert.ok(Number.isNaN(deRfc3339('cualquier cosa').getTime()));
  assert.ok(Number.isNaN(aInstante(new Date('x'))));
  assert.ok(Number.isNaN(ahoraEnArgentina('x').getTime()));
});
