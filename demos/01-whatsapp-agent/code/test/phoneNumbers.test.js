const test = require('node:test');
const assert = require('node:assert');

const { toWhatsAppRecipient } = require('../src/phoneNumbers');

test('saca el 9 de móvil de un celular argentino', () => {
  // El caso que motivó el módulo: el wa_id que manda Meta en el webhook no
  // sirve tal cual como destinatario.
  assert.strictEqual(toWhatsAppRecipient('5493511234567'), '543511234567');
});

test('acepta el mismo número en formato E.164', () => {
  assert.strictEqual(toWhatsAppRecipient('+5493511234567'), '543511234567');
});

test('ignora espacios, guiones y paréntesis', () => {
  assert.strictEqual(toWhatsAppRecipient('+54 9 351 123-4567'), '543511234567');
  assert.strictEqual(toWhatsAppRecipient('(+54) 9 351-1234567'), '543511234567');
});

test('deja intacto un argentino que ya viene sin el 9', () => {
  assert.strictEqual(toWhatsAppRecipient('543511234567'), '543511234567');
});

test('no toca el 9 si no es el prefijo de móvil', () => {
  // 11 es el código de área de Buenos Aires: el 9 de más adentro es parte del
  // abonado y tiene que sobrevivir.
  assert.strictEqual(toWhatsAppRecipient('541149876543'), '541149876543');
});

test('no toca números de otros países', () => {
  assert.strictEqual(toWhatsAppRecipient('+1 415 523 8886'), '14155238886');
  assert.strictEqual(toWhatsAppRecipient('+34 612 345 678'), '34612345678');
});

test('devuelve string vacío ante entradas vacías o inválidas', () => {
  assert.strictEqual(toWhatsAppRecipient(''), '');
  assert.strictEqual(toWhatsAppRecipient(null), '');
  assert.strictEqual(toWhatsAppRecipient(undefined), '');
  assert.strictEqual(toWhatsAppRecipient('sin dígitos'), '');
});

test('es idempotente', () => {
  const unaVez = toWhatsAppRecipient('+5493511234567');
  assert.strictEqual(toWhatsAppRecipient(unaVez), unaVez);
});
