const test = require('node:test');
const assert = require('node:assert');

const { aDestinatario } = require('../src/phoneNumbers');

test('deja el número como llegó, solo en dígitos', () => {
  // El `wa_id` del webhook es el identificador que Meta usa para esa
  // conversación: se le contesta a ese, sin reinterpretarlo.
  assert.strictEqual(aDestinatario('+5493571540208'), '5493571540208');
  assert.strictEqual(aDestinatario('5493571540208'), '5493571540208');
  assert.strictEqual(aDestinatario('+54 9 3571 54-0208'), '5493571540208');
  assert.strictEqual(aDestinatario('  +54-9-351-123-4567  '), '5493511234567');
});

test('no le saca el 9 de móvil argentino', () => {
  // Durante un tiempo se lo sacaba, porque mandar con el 9 fallaba y sin el 9
  // funcionaba —probado contra la API real, las dos formas—. Pero eso era una
  // casualidad de un solo teléfono: la lista de destinatarios de prueba de
  // Meta se compara literal, y ese número estaba cargado sin el 9.
  //
  // Con un segundo teléfono, cargado solo con el 9, dejaron de funcionar las
  // dos puntas a la vez: no se le podía contestar al cliente ni avisar al
  // dueño. Ver el comentario de cabecera de phoneNumbers.js.
  assert.strictEqual(aDestinatario('+5493571684980'), '5493571684980');
  assert.ok(!aDestinatario('+5493571684980').startsWith('543'), 'el 9 tiene que sobrevivir');
});

test('números de otros países pasan sin tocar', () => {
  assert.strictEqual(aDestinatario('+34 612 345 678'), '34612345678');
  assert.strictEqual(aDestinatario('+1 (415) 555-0100'), '14155550100');
});

test('una entrada vacía o inválida no rompe: devuelve cadena vacía', () => {
  for (const basura of ['', '   ', null, undefined, 'sin número', '+++']) {
    assert.strictEqual(aDestinatario(basura), '', JSON.stringify(basura));
  }
});
