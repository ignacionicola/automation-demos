/**
 * Tests del cableado del workflow, no de la lógica.
 *
 * Por qué existen: los módulos de src/ están bien cubiertos, pero el pegamento
 * entre nodos —qué campo pasa cada uno al siguiente, a qué nodo le pide datos—
 * vive en workflow.json y no lo toca ningún test. Ahí aparecieron dos bugs
 * reales: `Build LLM Request` leyendo `$input` después de que se insertara un
 * nodo en el medio, y `Parse Classification` sin copiar la transcripción al
 * item, que dejaba al agente sin texto ante cualquier nota de voz.
 *
 * Son aserciones baratas sobre el JSON ya construido, así que corren en la
 * misma suite y fallan antes de importar nada a n8n.
 */
const test = require('node:test');
const assert = require('node:assert');

const workflow = require('../../workflow.json');

const nodos = new Map(workflow.nodes.map((n) => [n.name, n]));
const codigo = (nombre) => {
  const nodo = nodos.get(nombre);
  assert.ok(nodo, `no existe el nodo "${nombre}"`);
  return (nodo.parameters && nodo.parameters.jsCode) || '';
};

test('las conexiones solo mencionan nodos que existen', () => {
  for (const [origen, conexion] of Object.entries(workflow.connections)) {
    assert.ok(nodos.has(origen), `la conexión sale de un nodo inexistente: "${origen}"`);
    for (const salida of conexion.main || []) {
      for (const destino of salida || []) {
        assert.ok(nodos.has(destino.node), `"${origen}" apunta a un nodo inexistente: "${destino.node}"`);
      }
    }
  }
});

test('cada $("Nodo") referencia un nodo que existe', () => {
  // Es lo que se rompe al renombrar o insertar nodos: la expresión sigue
  // compilando pero apunta a algo que ya no está.
  const referencia = /\$\('([^']+)'\)/g;

  for (const nodo of workflow.nodes) {
    const texto = JSON.stringify(nodo.parameters || {});
    for (const [, nombre] of texto.matchAll(referencia)) {
      assert.ok(nodos.has(nombre), `"${nodo.name}" referencia a "${nombre}", que no existe`);
    }
  }
});

test('la transcripción del audio llega hasta la respuesta', () => {
  // El bug: Parse Classification copia campos uno por uno, y sin esta línea la
  // transcripción se perdía — el FAQ y la búsqueda recibían un mensaje vacío.
  assert.match(
    codigo('Parse Classification'),
    /transcripcion: resultado\.transcripcion/,
    'Parse Classification tiene que copiar la transcripción al item',
  );
  assert.match(
    codigo('Update Conversation Memory'),
    /mensaje: item\.transcripcion \|\| item\.mensaje/,
    'la transcripción tiene que reemplazar al mensaje vacío del audio',
  );
});

test('los nodos que consumen el mensaje leen el del item, no el original vacío', () => {
  // Con una nota de voz, el mensaje del webhook viene vacío: el texto recién
  // existe después de transcribir, así que estos nodos no pueden leerlo de
  // "Normalize Inbound Message".
  for (const nombre of ['Answer FAQ', 'Build Handoff Messages']) {
    assert.match(codigo(nombre), /item\.mensaje/, `${nombre} debe usar el mensaje del item`);
    assert.ok(
      !/\$\('Normalize Inbound Message'\)[^\n]*mensaje/.test(codigo(nombre)),
      `${nombre} no debe leer el mensaje original, que en un audio está vacío`,
    );
  }
});

test('el audio se pide con el helper, no leyendo binary.data', () => {
  // binary.data trae "filesystem-v2" cuando n8n guarda los binarios en disco,
  // y Gemini responde 400. Hay que pedir el contenido real.
  const build = codigo('Build LLM Request');

  assert.match(build, /getBinaryDataBuffer/, 'hay que pedirle el contenido del binario a n8n');
  assert.ok(!/audioBase64: audio\.data/.test(build), 'binary.data no es el contenido del archivo');
});

test('los nodos que llaman APIs externas no cortan el flujo al fallar', () => {
  const externos = [
    'Read Conversation',
    'Remember Inbound Message',
    'Save Conversation Memory',
    'Get Audio URL',
    'Download Audio',
    'Notify Owner (WhatsApp)',
    'Send WhatsApp Reply (WhatsApp Cloud)',
  ];

  for (const nombre of externos) {
    const nodo = nodos.get(nombre);
    assert.ok(nodo, `falta el nodo "${nombre}"`);
    assert.strictEqual(
      nodo.onError,
      'continueRegularOutput',
      `"${nombre}" llama a una API externa: al fallar tiene que seguir, no cortar la respuesta al cliente`,
    );
  }
});

test('las dos ramas del clasificador convergen antes del ruteo', () => {
  // Si el fallback no pasara por la memoria, un fallo del modelo le borraría
  // el contexto al cliente.
  for (const rama of ['Parse Classification', 'Build Fallback Classification']) {
    assert.strictEqual(
      workflow.connections[rama].main[0][0].node,
      'Update Conversation Memory',
      `"${rama}" tiene que pasar por la memoria`,
    );
  }
});

test('los mensajes de texto no pasan por la descarga de audio', () => {
  const salidas = workflow.connections['Is Voice Note?'].main;

  assert.strictEqual(salidas[0][0].node, 'Get Audio URL', 'la rama verdadera baja el audio');
  assert.strictEqual(salidas[1][0].node, 'Audio or Text', 'la rama falsa se saltea la descarga');
});

test('las credenciales se referencian por nombre, para que enganchen al importar', () => {
  const esperadas = {
    'Receive WhatsApp Message (WhatsApp Trigger)': 'WhatsApp Cloud — Trigger OAuth',
    'Classify Intent (LLM)': 'LLM Provider — API Key',
    'Send WhatsApp Reply (WhatsApp Cloud)': 'WhatsApp Cloud — Access Token',
    'Notify Owner (WhatsApp)': 'WhatsApp Cloud — Access Token',
    'Get Audio URL': 'WhatsApp Cloud — Access Token',
    'Download Audio': 'WhatsApp Cloud — Access Token',
  };

  for (const [nombre, credencial] of Object.entries(esperadas)) {
    const nodo = nodos.get(nombre);
    assert.ok(nodo, `falta el nodo "${nombre}"`);
    const nombres = Object.values(nodo.credentials || {}).map((c) => c.name);
    assert.ok(nombres.includes(credencial), `"${nombre}" debería usar la credencial "${credencial}"`);
  }
});

test('no quedaron secretos ni datos personales dentro del workflow', () => {
  const texto = JSON.stringify(workflow);

  for (const patron of [/EAA[A-Za-z0-9]{20,}/, /AIza[A-Za-z0-9_-]{20,}/, /sk-ant-/, /gsk_[A-Za-z0-9]{20,}/]) {
    assert.ok(!patron.test(texto), `parece haber un secreto embebido (${patron})`);
  }
});

test('las fotos se mandan después del texto, no antes', () => {
  // Si salieran antes, el cliente vería las imágenes y recién después el
  // mensaje que las explica.
  assert.strictEqual(
    workflow.connections['Save Conversation Memory'].main[0][0].node,
    'Has Photos?',
    'las fotos van al final del flujo',
  );
  assert.strictEqual(workflow.connections['Has Photos?'].main[0][0].node, 'Split Property Photos');
  assert.strictEqual(workflow.connections['Split Property Photos'].main[0][0].node, 'Send Property Photos');
});

test('solo la rama de propiedades manda fotos', () => {
  const condicion = nodos.get('Has Photos?').parameters.conditions.conditions[0];

  assert.match(condicion.leftValue, /Update Conversation Memory/, 'se evalúa sobre un nodo que siempre corre');
  assert.strictEqual(condicion.rightValue, 'consulta_propiedad');
  assert.deepStrictEqual(workflow.connections['Has Photos?'].main[1], [], 'la rama falsa no manda nada');
});

test('el nodo de fotos manda imagen por link con pie de foto', () => {
  const envio = nodos.get('Send Property Photos');

  assert.strictEqual(envio.parameters.messageType, 'image');
  assert.strictEqual(envio.parameters.mediaPath, 'useMediaLink');
  assert.match(envio.parameters.mediaLink, /\$json\.link/);
  assert.match(envio.parameters.additionalFields.mediaCaption, /\$json\.caption/);
  assert.strictEqual(envio.onError, 'continueRegularOutput', 'una foto rota no debe romper nada');
});
