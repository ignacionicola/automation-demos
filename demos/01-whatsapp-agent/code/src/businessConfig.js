/**
 * Los datos del negocio y las preguntas frecuentes, leídos de la planilla.
 *
 * Por qué esto y no solo el catálogo: si el cliente puede cargar sus
 * propiedades pero no puede cambiar su propia comisión ni su horario, la
 * planilla es media configuración y el resto sigue siendo del desarrollador.
 *
 * El horario vive acá y en un solo lugar. Antes estaba repetido en seis: tres
 * constantes que validaban los turnos y cuatro textos que se lo contaban al
 * cliente. Con la planilla de por medio eso deja de ser una molestia y pasa a
 * ser una contradicción — la inmobiliaria cambia a "9 a 20", la FAQ lo dice y
 * el bot igual rechaza un turno a las 19:30. Por eso lo que se carga acá
 * maneja la validación, no solo el texto.
 */

const { celdaTexto, celdaEntero } = require('./sheetValues');

// Lo que estaba fijo en el código hasta ahora. Sigue siendo el default: la
// demo tiene que andar antes de que exista ninguna planilla.
const NEGOCIO_POR_DEFECTO = {
  nombre: 'Inmobiliaria Demo',
  direccion: 'Av. Colón 1250, Alberdi, Córdoba Capital',
  telefono: '',
  logo: null,
  horaApertura: 9,
  horaCierre: 19,
  // null = no se atiende los sábados.
  horaCierreSabado: 13,
};

const DIAS_LABORALES = 'lunes a viernes';

// Alias de las columnas clave/valor de la pestaña "negocio".
const COLUMNA_CLAVE = ['clave', 'campo', 'dato', 'key'];
const COLUMNA_VALOR = ['valor', 'value', 'contenido'];

// Alias de las claves en sí, para que no haya que escribirlas exactas.
const CLAVES = {
  nombre: ['nombre', 'nombre_inmobiliaria', 'agencia'],
  direccion: ['direccion', 'dirección', 'domicilio'],
  telefono: ['telefono', 'teléfono', 'tel', 'whatsapp'],
  logo: ['logo', 'logo_url', 'url_logo'],
  horaApertura: ['hora_apertura', 'apertura', 'abre'],
  horaCierre: ['hora_cierre', 'cierre', 'cierra'],
  horaCierreSabado: ['hora_cierre_sabado', 'hora_cierre_sábado', 'cierre_sabado', 'sabado'],
};

function llave(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function buscarColumna(fila, alias) {
  const claves = Object.keys(fila || {});
  for (const nombre of alias) {
    const clave = claves.find((k) => llave(k) === llave(nombre));
    if (clave !== undefined) return fila[clave];
  }
  return undefined;
}

/** Las filas clave/valor de la pestaña "negocio" a un mapa plano. */
function aMapa(filas) {
  const mapa = {};

  for (const fila of Array.isArray(filas) ? filas : []) {
    const clave = llave(buscarColumna(fila, COLUMNA_CLAVE));
    if (!clave) continue;
    mapa[clave] = buscarColumna(fila, COLUMNA_VALOR);
  }
  return mapa;
}

function primerValor(mapa, alias) {
  for (const nombre of alias) {
    const valor = mapa[llave(nombre)];
    if (valor !== undefined && celdaTexto(valor) !== '') return valor;
  }
  return undefined;
}

/**
 * Hora de atención válida (0 a 24), o el default. Se acepta "cerrado" para
 * los sábados, que devuelve null.
 */
function aHora(valor, porDefecto) {
  const texto = llave(valor);
  if (texto === 'cerrado' || texto === 'no' || texto === '-') return null;

  const hora = celdaEntero(valor);
  if (hora === null || hora < 0 || hora > 24) return porDefecto;
  return hora;
}

/**
 * @param {Array} filas de la pestaña "negocio"
 * @returns {object} config completa: lo que falte en la planilla usa el default
 */
function parsearNegocio(filas) {
  const mapa = aMapa(filas);
  const texto = (alias, porDefecto) => celdaTexto(primerValor(mapa, alias)) || porDefecto;

  const apertura = aHora(primerValor(mapa, CLAVES.horaApertura), NEGOCIO_POR_DEFECTO.horaApertura);
  const cierre = aHora(primerValor(mapa, CLAVES.horaCierre), NEGOCIO_POR_DEFECTO.horaCierre);

  return {
    nombre: texto(CLAVES.nombre, NEGOCIO_POR_DEFECTO.nombre),
    direccion: texto(CLAVES.direccion, NEGOCIO_POR_DEFECTO.direccion),
    telefono: texto(CLAVES.telefono, NEGOCIO_POR_DEFECTO.telefono),
    logo: texto(CLAVES.logo, '') || null,
    // Un cierre antes de la apertura dejaría la agencia sin ningún horario
    // válido y el bot rechazaría todos los turnos sin poder explicar por qué.
    horaApertura: apertura === null ? NEGOCIO_POR_DEFECTO.horaApertura : apertura,
    horaCierre: cierre === null || cierre <= apertura ? NEGOCIO_POR_DEFECTO.horaCierre : cierre,
    horaCierreSabado: aHora(primerValor(mapa, CLAVES.horaCierreSabado), NEGOCIO_POR_DEFECTO.horaCierreSabado),
  };
}

/** El horario como se lo cuenta al cliente, desde los mismos números que validan. */
function describirHorarios(negocio) {
  const config = negocio || NEGOCIO_POR_DEFECTO;
  const semana = `*${DIAS_LABORALES} de ${config.horaApertura} a ${config.horaCierre} hs*`;

  if (!config.horaCierreSabado) return semana;
  return `${semana} y los *sábados de ${config.horaApertura} a ${config.horaCierreSabado} hs*`;
}

/**
 * Completa {{nombre}}, {{direccion}}, {{telefono}} y {{horarios}} dentro de un
 * texto de la planilla. Es lo que hace que cambiar el horario en una celda se
 * propague a todas las respuestas que lo mencionan.
 *
 * Un placeholder desconocido se deja como está: es más fácil de ver en el chat
 * que un hueco en blanco, y le dice al cliente que se equivocó en el nombre.
 */
function resolverPlaceholders(texto, negocio) {
  const config = negocio || NEGOCIO_POR_DEFECTO;
  const valores = {
    nombre: config.nombre,
    direccion: config.direccion,
    telefono: config.telefono,
    horarios: describirHorarios(config),
  };

  return String(texto || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (original, clave) => {
    const valor = valores[llave(clave)];
    return valor === undefined || valor === '' ? original : valor;
  });
}

/**
 * Las filas de la pestaña "faq" a entradas como las que espera answerFaq.
 * Se descarta lo que no tenga respuesta: una entrada vacía solo sirve para que
 * el bot conteste con un silencio.
 */
function parsearFaq(filas) {
  const entradas = [];

  for (const fila of Array.isArray(filas) ? filas : []) {
    const id = celdaTexto(buscarColumna(fila, ['id', 'clave', 'tema']));
    const respuesta = celdaTexto(buscarColumna(fila, ['respuesta', 'texto', 'contenido']));
    if (!id || !respuesta) continue;

    entradas.push({
      id,
      pregunta: celdaTexto(buscarColumna(fila, ['pregunta', 'consulta'])),
      claves: celdaTexto(buscarColumna(fila, ['claves', 'palabras_clave', 'keywords']))
        .split(/[,\n|;]+/)
        .map((c) => c.trim())
        .filter(Boolean),
      respuesta,
    });
  }

  return entradas;
}

module.exports = {
  NEGOCIO_POR_DEFECTO,
  parsearNegocio,
  parsearFaq,
  describirHorarios,
  resolverPlaceholders,
  aMapa,
  aHora,
};
