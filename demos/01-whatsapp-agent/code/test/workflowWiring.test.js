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
const vm = require('node:vm');

const workflow = require('../../workflow.json');

const nodos = new Map(workflow.nodes.map((n) => [n.name, n]));
const codeNodes = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.code');
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
    'Check Calendar Availability',
    'Create Calendar Event',
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
    'Check Calendar Availability': 'Google Calendar — OAuth2',
    'Create Calendar Event': 'Google Calendar — OAuth2',
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

test('nunca se crea un evento sin haber mirado la agenda', () => {
  // El orden es la garantía de no pisarle una visita al dueño: si alguna vez
  // alguien cablea "Can Book?" directo contra la creación, esto lo frena.
  assert.strictEqual(workflow.connections['Can Book?'].main[0][0].node, 'Check Calendar Availability');
  assert.strictEqual(workflow.connections['Check Calendar Availability'].main[0][0].node, 'Resolve Slot');
  assert.strictEqual(workflow.connections['Resolve Slot'].main[0][0].node, 'Slot Free?');
  assert.strictEqual(workflow.connections['Slot Free?'].main[0][0].node, 'Create Calendar Event');
});

test('los tres caminos que no agendan terminan en el mismo mensaje', () => {
  // Faltan datos, el horario está tomado, o se agendó: el cliente siempre
  // recibe una respuesta. Una rama muda es un cliente esperando.
  for (const [nodo, salida] of [
    ['Can Book?', 1],
    ['Slot Free?', 1],
    ['Log Visit Locally', 0],
  ]) {
    assert.strictEqual(
      workflow.connections[nodo].main[salida][0].node,
      'Format Scheduling Reply',
      `"${nodo}" tiene que contestarle al cliente`,
    );
  }
});

test('la consulta de agenda emite item aunque el día esté libre', () => {
  // Con outputFormat bookedSlots, un día sin nada ocupado devuelve [] y n8n no
  // emitiría ningún item: la rama moriría en silencio justo en el caso bueno.
  const consulta = nodos.get('Check Calendar Availability');

  assert.strictEqual(consulta.alwaysOutputData, true);
  assert.strictEqual(consulta.parameters.options.outputFormat, 'bookedSlots');
});

test('la planilla se lee una vez y se reusa un rato', () => {
  // Sin el caché, cada "hola" cuesta una llamada a Sheets para releer un
  // catálogo que cambia una vez por semana.
  assert.strictEqual(workflow.connections['Load Config'].main[0][0].node, 'Config Cached?');

  const salidas = workflow.connections['Config Cached?'].main;
  assert.strictEqual(salidas[0][0].node, 'Config Ready', 'con caché fresco no se lee nada');
  assert.strictEqual(salidas[1][0].node, 'Read Spreadsheet');
  assert.strictEqual(salidas[0][0].index, 1, 'entra por la otra pata del merge');
});

test('las tres pestañas se traen en una sola llamada', () => {
  // Con un nodo de Google Sheets por pestaña, cada uno pedía su propio token:
  // tres pedidos seguidos que Google frenaba, hasta 65 segundos y un error en
  // la tercera. values:batchGet las trae todas en algo más de un segundo.
  const lectura = nodos.get('Read Spreadsheet');

  assert.ok(lectura, 'falta el nodo de lectura');
  assert.strictEqual(lectura.type, 'n8n-nodes-base.httpRequest');
  assert.match(lectura.parameters.url, /values:batchGet/);
  assert.match(lectura.parameters.url, /\$env\.SHEETS_DOCUMENT_ID/);

  // Las pestañas se piden por nombre: el cliente duplica la plantilla y los
  // nombres viajan con ella, los IDs no.
  const rangos = lectura.parameters.queryParameters.parameters
    .filter((p) => p.name === 'ranges')
    .map((p) => p.value);
  assert.deepStrictEqual(rangos, ['propiedades', 'negocio', 'faq']);

  // Y sigue sin poder cortar el flujo: cero filas o un fallo caen al respaldo.
  assert.strictEqual(lectura.alwaysOutputData, true);
  assert.strictEqual(lectura.onError, 'continueRegularOutput');
  assert.strictEqual(lectura.credentials.googleApi.name, 'Google Sheets — Service Account');

  // Ninguno de los tres nodos viejos puede quedar suelto.
  for (const viejo of ['Read Properties Sheet', 'Read Business Sheet', 'Read FAQ Sheet']) {
    assert.ok(!nodos.has(viejo), `"${viejo}" quedó del diseño anterior`);
  }
});

test('si la planilla falla se usa el catálogo del repo', () => {
  const build = codigo('Build Config');

  assert.match(build, /construirConfig/);
  assert.match(build, /PROPIEDADES/, 'el respaldo viaja adentro del workflow');
  assert.match(build, /filasDeRango/, 'la respuesta de batchGet trae arrays, no objetos');
  assert.match(build, /describirOrigen/, 'y tiene que quedar registrado de dónde salió');
});

test('los nodos que usan el catálogo lo leen de la config, no del JSON fijo', () => {
  for (const nombre of ['Match Properties', 'Answer FAQ', 'Validate Visit Request']) {
    assert.match(codigo(nombre), /\$\('Config Ready'\)/, `"${nombre}" tiene que leer la planilla`);
  }

  // El horario de la planilla tiene que validar los turnos, no solo aparecer
  // en el texto: si no, la agencia cambia a "9 a 20", el bot lo dice y sigue
  // rechazando las 19:30.
  assert.match(codigo('Validate Visit Request'), /negocio/);
  assert.match(codigo('Resolve Slot'), /cierreDelDia\(cuando\.getDay\(\), negocio\)/);
});

test('un saludo no puede terminar en una reserva', () => {
  // Pasó de verdad: con una fecha y una propiedad todavía en memoria, un
  // "hola buenas" se clasificó como continuación y agendó una visita. El
  // freno va en código, no en el prompt: no puede depender del modelo.
  const parse = codigo('Parse Classification');

  assert.match(parse, /esSoloSaludo/);
  assert.match(
    parse,
    /esSaludo \? 'consulta_general' : resultado\.intent/,
    'el saludo pisa lo que haya decidido el modelo',
  );
});

test('una visita agendada se borra de la memoria', () => {
  // Si sus datos siguieran cargados, el próximo mensaje corto los reusaría y
  // agendaría una segunda visita que nadie pidió.
  const log = codigo('Log Delivery Result');

  assert.match(log, /olvidarVisita/);
  assert.match(log, /validacion\.valido/, 'solo si de verdad se agendó');
});

test('lo que se le mostró al cliente queda guardado en la memoria', () => {
  // "Update Conversation Memory" corre antes del ruteo, así que no puede saber
  // qué se mostró. "Log Delivery Result" es el último Code node por el que
  // pasan todas las ramas y para entonces la búsqueda ya corrió: si la
  // escritura volviera a leer de la memoria vieja, el dato se perdería.
  const log = codigo('Log Delivery Result');

  assert.match(log, /recordarPropiedadesMostradas/);
  assert.match(
    log,
    /intent === 'consulta_propiedad'/,
    'a Format Property Reply solo se le puede pedir datos si esa rama corrió',
  );

  const guardado = nodos.get('Save Conversation Memory').parameters.columns.value;
  assert.match(guardado.estado, /Log Delivery Result/, 'tiene que guardar el estado enriquecido');
});

test('el calendario se referencia con un ID que el nodo acepte', () => {
  // El campo valida contra una regex con forma de mail y rechaza el valor
  // antes de llamar a Google, así que "primary" no sirve por más que sea el
  // alias que usa la API. Costó una tanda de mensajes averiguarlo: el nodo
  // falla con "Calendar parameter's value is invalid", que no lo dice.
  for (const nombre of ['Check Calendar Availability', 'Create Calendar Event']) {
    const calendario = nodos.get(nombre).parameters.calendar;

    assert.strictEqual(calendario.mode, 'id');
    assert.match(calendario.value, /\$env\.GOOGLE_CALENDAR_ID/, 'el calendario se configura por entorno');
    assert.ok(!/primary/.test(calendario.value), '"primary" no pasa la validación del campo');
  }
});

test('la creación del evento es lo que manda la invitación al cliente', () => {
  const crear = nodos.get('Create Calendar Event').parameters;

  assert.strictEqual(crear.operation, 'create');
  // Sin sendUpdates: all Google crea el evento pero no avisa a nadie, que es
  // exactamente lo que el cliente espera recibir.
  assert.strictEqual(crear.additionalFields.sendUpdates, 'all');

  // La expresión tiene que ser el array entero, no un elemento adentro de uno.
  // Con `[invitados.join(',')]`, una visita sin mail manda un invitado con la
  // dirección vacía y Google contesta 400: el evento no se crea y el cliente
  // se queda esperando a un asesor que nadie avisó.
  assert.strictEqual(
    crear.additionalFields.attendees,
    '={{ $json.evento.invitados }}',
    'sin invitados, el array tiene que quedar vacío',
  );
  assert.match(crear.start, /evento\.inicio/);
  assert.match(crear.end, /evento\.fin/);
});

test('las horas que se le mandan a Calendar llevan zona horaria explícita', () => {
  // El evento se arma en src/, y ahí las fechas salen con el offset argentino.
  // Si alguien lo cambiara por un toISOString(), la visita se agendaría tres
  // horas corrida en cualquier servidor que no esté en Argentina.
  assert.match(codigo('Validate Visit Request'), /aRfc3339/);
  assert.ok(
    !/cuando\.toISOString\(\)/.test(codigo('Validate Visit Request')),
    'toISOString() manda UTC y pierde la hora que se acordó con el cliente',
  );
});

test('el mensaje solo promete la invitación si Calendar la aceptó', () => {
  assert.match(codigo('Log Visit Locally'), /respuesta\.id/, 'hay que mirar el id, no asumir que salió bien');
  assert.match(codigo('Format Scheduling Reply'), /calendario: item\.calendario/);
});

test('los Code nodes compilan y no tienen nombres pisados', () => {
  // build-workflow.js concatena varios módulos de src/ en un mismo scope. Si
  // dos declaran la misma función, el Code node no compila — y eso recién se
  // vería al ejecutar el workflow contra WhatsApp.
  for (const nodo of codeNodes) {
    const jsCode = nodo.parameters.jsCode;

    assert.doesNotThrow(
      // Envuelto igual que lo envuelve n8n, para admitir await de nivel superior.
      () => new vm.Script(`(async () => {${jsCode}})()`),
      `el código de "${nodo.name}" no compila`,
    );

    const declarados = [...jsCode.matchAll(/^(?:function\s+(\w+)|const\s+(\w+)\s*=)/gm)].map(
      (m) => m[1] || m[2],
    );
    const repetidos = [...new Set(declarados.filter((n, i) => declarados.indexOf(n) !== i))];
    assert.deepStrictEqual(repetidos, [], `"${nodo.name}" declara dos veces: ${repetidos.join(', ')}`);
  }
});

test('la inyección no deja require() ni module.exports adentro del sandbox', () => {
  // El Code node corre sandboxeado: cualquiera de los dos tira error en
  // ejecución. build-workflow.js los saca con un filtro línea por línea, así
  // que un require partido en varias líneas se le escaparía.
  for (const nodo of codeNodes) {
    assert.ok(
      !/^\s*(?:const|let|var)\s+.*=\s*require\(/m.test(nodo.parameters.jsCode),
      `quedó un require() en "${nodo.name}"`,
    );
    assert.ok(!/module\.exports/.test(nodo.parameters.jsCode), `quedó un module.exports en "${nodo.name}"`);
  }
});

test('el nodo de fotos manda imagen por link con pie de foto', () => {
  const envio = nodos.get('Send Property Photos');

  assert.strictEqual(envio.parameters.messageType, 'image');
  assert.strictEqual(envio.parameters.mediaPath, 'useMediaLink');
  assert.match(envio.parameters.mediaLink, /\$json\.link/);
  assert.match(envio.parameters.additionalFields.mediaCaption, /\$json\.caption/);
  assert.strictEqual(envio.onError, 'continueRegularOutput', 'una foto rota no debe romper nada');
});
