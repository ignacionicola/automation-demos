/**
 * Notas de voz de WhatsApp.
 *
 * Por qué existe: el público de una inmobiliaria manda audios todo el tiempo.
 * Hasta ahora cualquier mensaje que no fuera texto terminaba en
 * `derivar_humano`, así que la mitad de las consultas no las atendía el agente.
 *
 * Cómo funciona: Meta no manda el audio en el webhook, manda un **media ID**.
 * Hay que pedirle a la Graph API la URL de descarga (que caduca a los ~5
 * minutos), bajar el binario con el mismo access token, y mandárselo a Gemini
 * como `inline_data` junto al prompt de clasificación.
 *
 * La ventaja de hacerlo con Gemini y no con un servicio de transcripción
 * aparte: **una sola llamada** devuelve la transcripción, el intent y las
 * entidades. No hay que transcribir primero y clasificar después, ni pagar dos
 * servicios, ni manejar el desfasaje entre ambos.
 *
 * Este módulo es solo la lógica de decisión — qué es un audio, si se puede
 * procesar y por qué no. La descarga la hacen los nodos HTTP del workflow.
 */

// Solo Gemini acepta audio como entrada en la misma llamada que clasifica.
// Anthropic no recibe audio, y Groq lo hace por un endpoint aparte (Whisper),
// lo que sería otra request y otra pieza de configuración.
const PROVEEDORES_CON_AUDIO = ['gemini'];

// Los formatos que acepta Gemini como inline_data. WhatsApp manda las notas de
// voz en OGG/Opus; el resto están para audios reenviados desde otra app.
const MIMES_SOPORTADOS = [
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/aac',
  'audio/wav',
  'audio/flac',
  'audio/aiff',
];

// Tope de tamaño del audio. WhatsApp permite hasta 16 MB, pero el base64 infla
// ~33% y todo eso viaja dentro del JSON de la request a Gemini. Por encima de
// esto conviene derivar a un humano antes que arriesgar un 413.
const TAMANIO_MAXIMO_BYTES = 12 * 1024 * 1024;

function soportaAudio(proveedor) {
  return PROVEEDORES_CON_AUDIO.includes(String(proveedor || '').toLowerCase().trim());
}

/**
 * Meta manda el mime con parámetros: "audio/ogg; codecs=opus". Gemini quiere
 * el tipo pelado, sin los parámetros.
 */
function normalizarMime(mime) {
  return String(mime || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

function mimeSoportado(mime) {
  return MIMES_SOPORTADOS.includes(normalizarMime(mime));
}

/**
 * Saca los datos del audio de un mensaje del webhook de Meta.
 *
 * @returns {{esAudio: boolean, mediaId: string|null, mime: string|null, esNotaDeVoz: boolean}}
 */
function datosDeAudio(mensajeEntrante) {
  const mensaje = mensajeEntrante || {};
  if (mensaje.type !== 'audio' || !mensaje.audio) {
    return { esAudio: false, mediaId: null, mime: null, esNotaDeVoz: false };
  }

  return {
    esAudio: true,
    mediaId: mensaje.audio.id || null,
    mime: normalizarMime(mensaje.audio.mime_type),
    // Meta distingue la nota de voz grabada en el momento (voice: true) de un
    // archivo de audio adjuntado. Se procesan igual; el dato queda por si
    // después se quiere tratarlos distinto.
    esNotaDeVoz: mensaje.audio.voice === true,
  };
}

/**
 * Por qué este audio no se puede procesar, en un texto que puede leer una
 * persona (termina en el aviso al dueño cuando se deriva).
 *
 * @returns {string|null} null si se puede procesar
 */
function motivoAudioNoProcesable(datos) {
  const { proveedor, mediaId, mime, tamanioBytes } = datos || {};

  if (!mediaId) {
    return 'La nota de voz llegó sin identificador de archivo';
  }
  if (!soportaAudio(proveedor)) {
    return `El proveedor de IA configurado (${proveedor || 'desconocido'}) no procesa audio`;
  }
  if (!mimeSoportado(mime)) {
    return `El formato del audio no está soportado (${normalizarMime(mime) || 'desconocido'})`;
  }
  if (typeof tamanioBytes === 'number' && tamanioBytes > TAMANIO_MAXIMO_BYTES) {
    const mb = (tamanioBytes / 1024 / 1024).toFixed(1);
    return `La nota de voz es demasiado larga (${mb} MB)`;
  }

  return null;
}

/**
 * Texto con el que se representa el audio hasta que el modelo lo transcriba.
 *
 * Hace falta porque el mensaje entrante se guarda en la memoria *antes* de
 * llamar al LLM (para que un segundo mensaje simultáneo lo encuentre), y en
 * ese momento todavía no existe la transcripción. Una vez que vuelve, se
 * reemplaza por el texto real.
 */
const MARCADOR_AUDIO_SIN_TRANSCRIBIR = '(nota de voz)';

/**
 * Pasa a base64 lo que devuelve n8n al pedir el contenido de un binario.
 *
 * Por qué no alcanza con leer `binary.audio.data`: n8n guarda los binarios en
 * disco (modo `filesystem`), y en ese caso ese campo trae el marcador
 * `"filesystem-v2"` en vez del contenido. Mandarlo tal cual a Gemini devuelve
 * un 400 — *Base64 decoding failed for "filesystem-v2"* — que fue exactamente
 * lo que pasó la primera vez que se probó. El contenido real hay que pedirlo
 * con `helpers.getBinaryDataBuffer()`, y lo que vuelve puede ser un Buffer, un
 * Uint8Array o la forma serializada `{type:'Buffer',data:[…]}` según por dónde
 * pase; se contemplan las tres.
 *
 * @returns {string|null} base64 sin prefijo, o null si no hay nada usable
 */
function aBase64(contenido) {
  if (!contenido) return null;

  // Ya viene en base64 (modo de binarios en memoria).
  if (typeof contenido === 'string') return contenido;

  if (typeof Buffer !== 'undefined') {
    if (Buffer.isBuffer(contenido)) return contenido.toString('base64');
    if (contenido.type === 'Buffer' && Array.isArray(contenido.data)) {
      return Buffer.from(contenido.data).toString('base64');
    }
    if (contenido instanceof Uint8Array) return Buffer.from(contenido).toString('base64');
  }

  return null;
}

module.exports = {
  soportaAudio,
  aBase64,
  normalizarMime,
  mimeSoportado,
  datosDeAudio,
  motivoAudioNoProcesable,
  PROVEEDORES_CON_AUDIO,
  MIMES_SOPORTADOS,
  TAMANIO_MAXIMO_BYTES,
  MARCADOR_AUDIO_SIN_TRANSCRIBIR,
};
