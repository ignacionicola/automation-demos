#!/usr/bin/env node
/**
 * Inyecta la lógica de src/ dentro de los Code nodes de ../workflow.json.
 *
 * Por qué existe: el Code node de n8n corre sandboxeado y no puede hacer
 * require() de archivos locales, así que la lógica tiene que vivir dentro del
 * propio workflow.json. En vez de mantener dos copias a mano (y que se
 * desincronicen), la fuente de verdad es src/ y este script la copia adentro
 * del JSON, entre marcadores.
 *
 *   npm run build:workflow     escribe workflow.json
 *   npm run check:workflow     falla si el workflow.json commiteado está viejo
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');
const WORKFLOW = path.resolve(RAIZ, '..', 'workflow.json');

const INICIO = '// <<< BEGIN GENERATED';
const FIN = '// <<< END GENERATED >>>';

/**
 * Qué se inyecta en cada Code node. `datos` inlinea un .json como constante;
 * `modulos` inlinea el código fuente de cada archivo de src/.
 *
 * Cuidado al agregar módulos a un mismo nodo: no pueden compartir nombres de
 * función o constante, porque terminan concatenados en el mismo scope.
 */
const BUNDLES = {
  'Normalize Inbound Message': {
    datos: {},
    modulos: ['phoneNumbers.js', 'voiceNotes.js'],
  },
  'Build Classification Prompt': {
    datos: {},
    modulos: ['localTime.js', 'conversationMemory.js', 'voiceNotes.js'],
  },
  'Update Conversation Memory': {
    datos: {},
    modulos: ['conversationMemory.js'],
  },
  // Anota en la memoria qué propiedades se mostraron: es el último Code node
  // por el que pasan todas las ramas, y para entonces la búsqueda ya corrió.
  'Log Delivery Result': {
    datos: {},
    modulos: ['conversationMemory.js'],
  },
  'Build LLM Request': {
    datos: {},
    modulos: ['llmProviders.js', 'voiceNotes.js'],
  },
  'Build Fallback Classification': {
    datos: {},
    modulos: ['llmFailureReason.js'],
  },
  'Parse Classification': {
    // llmProviders.js primero: parseClassification.js llama a extractLlmText,
    // que tiene que estar ya definida en el scope cuando se inyectan las dos
    // en el mismo Code node.
    //
    // answerFaq.js va por esSoloSaludo: un saludo se fuerza a consulta_general
    // acá, sin depender de lo que haya decidido el modelo.
    datos: {},
    modulos: ['llmProviders.js', 'parseClassification.js', 'answerFaq.js'],
  },
  'Match Properties': {
    datos: { PROPIEDADES: 'properties.json' },
    modulos: ['matchProperties.js'],
  },
  'Format Property Reply': {
    datos: {},
    modulos: ['formatPropertyReply.js'],
  },
  'Answer FAQ': {
    datos: { PREGUNTAS_FRECUENTES: 'faq.json' },
    modulos: ['answerFaq.js'],
  },
  // Los tres nodos de agendado comparten el mismo trío, y en este orden:
  // scheduling.js usa funciones de calendarEvent.js, que a su vez usa las de
  // localTime.js. Concatenados en un mismo scope, las dependencias tienen que
  // quedar declaradas antes.
  'Validate Visit Request': {
    // El catálogo, para resolver el código de propiedad a una dirección real
    // que viaje dentro del evento de Calendar.
    datos: { PROPIEDADES: 'properties.json' },
    modulos: ['localTime.js', 'calendarEvent.js', 'scheduling.js'],
  },
  'Resolve Slot': {
    datos: {},
    modulos: ['localTime.js', 'calendarEvent.js', 'scheduling.js'],
  },
  'Format Scheduling Reply': {
    datos: {},
    modulos: ['localTime.js', 'calendarEvent.js', 'scheduling.js'],
  },
};

/**
 * Saca los require() y el module.exports: adentro del Code node no aplican.
 *
 * El bloque multilínea se corta primero y entero. Si se filtrara línea por
 * línea, de `module.exports = {\n  algo,\n};` sobrevivirían las líneas del
 * medio y el resultado no compilaría.
 */
function limpiarModulo(fuente) {
  return fuente
    .replace(/^module\.exports\s*=\s*\{[\s\S]*?^\};?[ \t]*$/m, '')
    .split('\n')
    .filter((linea) => !/^\s*(const|let|var)\s+.*=\s*require\(/.test(linea))
    .filter((linea) => !/^\s*module\.exports\s*=/.test(linea))
    .join('\n')
    .trim();
}

function construirBloque(nombreNodo, bundle) {
  const partes = [
    `${INICIO} — generado por code/scripts/build-workflow.js, no editar a mano >>>`,
  ];

  for (const [constante, archivo] of Object.entries(bundle.datos)) {
    const datos = JSON.parse(fs.readFileSync(path.join(RAIZ, 'src', archivo), 'utf8'));
    partes.push(`// Datos de src/${archivo}`);
    partes.push(`const ${constante} = ${JSON.stringify(datos, null, 2)};`);
  }

  for (const archivo of bundle.modulos) {
    const fuente = fs.readFileSync(path.join(RAIZ, 'src', archivo), 'utf8');
    partes.push(`// Lógica de src/${archivo}`);
    partes.push(limpiarModulo(fuente));
  }

  partes.push(FIN);
  return partes.join('\n\n');
}

function inyectarEnNodo(nodo, bloque) {
  const codigo = nodo.parameters && nodo.parameters.jsCode;
  if (typeof codigo !== 'string') {
    throw new Error(`El nodo "${nodo.name}" no tiene jsCode`);
  }

  const desde = codigo.indexOf(INICIO);
  const hasta = codigo.indexOf(FIN);
  if (desde === -1 || hasta === -1) {
    throw new Error(`El nodo "${nodo.name}" no tiene los marcadores BEGIN/END GENERATED`);
  }

  return codigo.slice(0, desde) + bloque + codigo.slice(hasta + FIN.length);
}

function construir() {
  const workflow = JSON.parse(fs.readFileSync(WORKFLOW, 'utf8'));
  const porNombre = new Map(workflow.nodes.map((nodo) => [nodo.name, nodo]));

  for (const [nombre, bundle] of Object.entries(BUNDLES)) {
    const nodo = porNombre.get(nombre);
    if (!nodo) {
      throw new Error(`workflow.json no tiene un nodo llamado "${nombre}"`);
    }
    nodo.parameters.jsCode = inyectarEnNodo(nodo, construirBloque(nombre, bundle));
  }

  return `${JSON.stringify(workflow, null, 2)}\n`;
}

function main() {
  const modoCheck = process.argv.includes('--check');
  const generado = construir();
  const actual = fs.readFileSync(WORKFLOW, 'utf8');

  if (modoCheck) {
    if (generado !== actual) {
      console.error('workflow.json está desactualizado respecto de code/src/.');
      console.error('Corré: npm run build:workflow');
      process.exit(1);
    }
    console.log('workflow.json está al día con code/src/.');
    return;
  }

  if (generado === actual) {
    console.log('workflow.json ya estaba al día, no hubo cambios.');
    return;
  }

  fs.writeFileSync(WORKFLOW, generado);
  console.log(`workflow.json actualizado (${Object.keys(BUNDLES).length} Code nodes inyectados).`);
}

main();
