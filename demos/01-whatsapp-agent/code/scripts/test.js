#!/usr/bin/env node
/**
 * Corre la suite dos veces: en la zona horaria de la máquina y en UTC.
 *
 * Por qué: la lógica de agendado hace cuentas de calendario, y desde que la
 * agenda es Google Calendar una hora corrida deja de ser un detalle — es una
 * visita a las 13 en la agenda del dueño cuando el cliente acordó las 16. La
 * máquina de desarrollo está en horario argentino, así que el bug no aparece;
 * el contenedor de `deploy/` corre en UTC, donde sí.
 *
 * Correrla en las dos zonas es la forma barata de que ese caso no dependa de
 * acordarse. Ver src/localTime.js.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');
const ARGUMENTOS = ['--test', 'test/*.test.js'];

// La primera pasada usa la zona de la máquina, tal como la ve quien desarrolla.
const PASADAS = [
  { nombre: `zona local (${Intl.DateTimeFormat().resolvedOptions().timeZone || 'sin definir'})`, tz: null },
  { nombre: 'UTC (como el contenedor de deploy/)', tz: 'UTC' },
];

for (const pasada of PASADAS) {
  console.log(`\n=== Tests en ${pasada.nombre} ===\n`);

  const entorno = { ...process.env };
  if (pasada.tz) entorno.TZ = pasada.tz;

  const resultado = spawnSync(process.execPath, ARGUMENTOS, {
    cwd: RAIZ,
    env: entorno,
    stdio: 'inherit',
  });

  if (resultado.status !== 0) {
    console.error(`\nFallaron los tests en ${pasada.nombre}.`);
    process.exit(resultado.status || 1);
  }
}

console.log('\nLa suite pasa en las dos zonas horarias.');
