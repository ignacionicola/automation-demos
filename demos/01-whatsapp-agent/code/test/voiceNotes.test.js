const test = require('node:test');
const assert = require('node:assert');

const {
  soportaAudio,
  aBase64,
  normalizarMime,
  mimeSoportado,
  datosDeAudio,
  motivoAudioNoProcesable,
  TAMANIO_MAXIMO_BYTES,
} = require('../src/voiceNotes');

// Un mensaje de audio tal como lo manda el webhook de Meta.
const NOTA_DE_VOZ = {
  from: '5493511234567',
  id: 'wamid.XXXX',
  type: 'audio',
  audio: { id: '1234567890', mime_type: 'audio/ogg; codecs=opus', voice: true, sha256: 'abc' },
};

const MENSAJE_DE_TEXTO = {
  from: '5493511234567',
  type: 'text',
  text: { body: 'busco depto en Nueva Córdoba' },
};

test('reconoce una nota de voz y saca el media ID', () => {
  const datos = datosDeAudio(NOTA_DE_VOZ);

  assert.strictEqual(datos.esAudio, true);
  assert.strictEqual(datos.mediaId, '1234567890');
  assert.strictEqual(datos.esNotaDeVoz, true);
});

test('un mensaje de texto no es audio', () => {
  const datos = datosDeAudio(MENSAJE_DE_TEXTO);

  assert.strictEqual(datos.esAudio, false);
  assert.strictEqual(datos.mediaId, null);
});

test('distingue la nota de voz grabada del audio adjuntado', () => {
  const adjuntado = { type: 'audio', audio: { id: '9', mime_type: 'audio/mpeg', voice: false } };

  assert.strictEqual(datosDeAudio(adjuntado).esAudio, true);
  assert.strictEqual(datosDeAudio(adjuntado).esNotaDeVoz, false);
});

test('saca los parámetros del mime, que Gemini no acepta', () => {
  // El caso real: WhatsApp manda "audio/ogg; codecs=opus".
  assert.strictEqual(normalizarMime('audio/ogg; codecs=opus'), 'audio/ogg');
  assert.strictEqual(normalizarMime('AUDIO/OGG'), 'audio/ogg');
  assert.strictEqual(datosDeAudio(NOTA_DE_VOZ).mime, 'audio/ogg');
});

test('acepta los formatos que entiende Gemini y rechaza el resto', () => {
  assert.ok(mimeSoportado('audio/ogg; codecs=opus'));
  assert.ok(mimeSoportado('audio/mpeg'));
  assert.ok(!mimeSoportado('video/mp4'));
  assert.ok(!mimeSoportado('application/pdf'));
  assert.ok(!mimeSoportado(''));
});

test('solo Gemini procesa audio', () => {
  assert.strictEqual(soportaAudio('gemini'), true);
  assert.strictEqual(soportaAudio('GEMINI'), true);
  assert.strictEqual(soportaAudio('anthropic'), false);
  assert.strictEqual(soportaAudio('groq'), false);
  assert.strictEqual(soportaAudio(''), false);
  assert.strictEqual(soportaAudio(undefined), false);
});

test('una nota de voz normal con Gemini se puede procesar', () => {
  const motivo = motivoAudioNoProcesable({
    proveedor: 'gemini',
    mediaId: '1234567890',
    mime: 'audio/ogg; codecs=opus',
    tamanioBytes: 250_000,
  });

  assert.strictEqual(motivo, null);
});

test('explica en castellano por qué no se puede procesar', () => {
  const conOtroProveedor = motivoAudioNoProcesable({
    proveedor: 'anthropic',
    mediaId: '1',
    mime: 'audio/ogg',
  });
  assert.match(conOtroProveedor, /anthropic/);
  assert.match(conOtroProveedor, /no procesa audio/);

  const formatoRaro = motivoAudioNoProcesable({ proveedor: 'gemini', mediaId: '1', mime: 'video/mp4' });
  assert.match(formatoRaro, /formato/i);
  assert.match(formatoRaro, /video\/mp4/);

  const sinId = motivoAudioNoProcesable({ proveedor: 'gemini', mediaId: null, mime: 'audio/ogg' });
  assert.match(sinId, /identificador/i);
});

test('rechaza los audios demasiado grandes, con el tamaño en el motivo', () => {
  const motivo = motivoAudioNoProcesable({
    proveedor: 'gemini',
    mediaId: '1',
    mime: 'audio/ogg',
    tamanioBytes: TAMANIO_MAXIMO_BYTES + 1,
  });

  assert.match(motivo, /demasiado larga/i);
  assert.match(motivo, /MB/);
});

test('sin saber el tamaño, no lo usa como excusa para rechazar', () => {
  const motivo = motivoAudioNoProcesable({ proveedor: 'gemini', mediaId: '1', mime: 'audio/ogg' });

  assert.strictEqual(motivo, null);
});

test('no rompe con entradas vacías o inesperadas', () => {
  assert.doesNotThrow(() => datosDeAudio(null));
  assert.doesNotThrow(() => datosDeAudio({}));
  assert.doesNotThrow(() => datosDeAudio({ type: 'audio' }));
  assert.doesNotThrow(() => motivoAudioNoProcesable(null));
  assert.strictEqual(datosDeAudio({ type: 'audio' }).esAudio, false, 'sin objeto audio no alcanza');
});

test('aBase64 acepta las formas en que n8n devuelve un binario', () => {
  const bytes = Buffer.from('OggS-fake-audio');
  const esperado = bytes.toString('base64');

  assert.strictEqual(aBase64(bytes), esperado, 'Buffer');
  assert.strictEqual(aBase64(new Uint8Array(bytes)), esperado, 'Uint8Array');
  assert.strictEqual(aBase64({ type: 'Buffer', data: [...bytes] }), esperado, 'Buffer serializado por RPC');
});

test('aBase64 deja pasar un base64 que ya venía como string', () => {
  // Es el caso del modo de binarios en memoria, donde binary.data ya es base64.
  assert.strictEqual(aBase64('T2dnUwACAAAA'), 'T2dnUwACAAAA');
});

test('aBase64 devuelve null en vez de basura', () => {
  assert.strictEqual(aBase64(null), null);
  assert.strictEqual(aBase64(undefined), null);
  assert.strictEqual(aBase64(0), null);
  assert.strictEqual(aBase64({ vaya: 'cosa' }), null);
});
