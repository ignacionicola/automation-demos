/**
 * Números para la WhatsApp Cloud API.
 *
 * La regla terminó siendo mucho más simple de lo que parecía: **se manda el
 * número tal como llega**, sin corregirle nada. Vale la pena contar por qué,
 * porque el camino equivocado es convincente.
 *
 * Al principio, mandarle a un celular argentino con el 9 de móvil
 * (`5493571684980`, que es exactamente el `wa_id` que entrega el webhook)
 * fallaba con `(#131030) Recipient phone number not in allowed list`, y
 * mandarle sin el 9 (`543571684980`) funcionaba. Probado contra la API real,
 * las dos formas, mismo número. La conclusión parecía obvia: la Cloud API
 * rechaza el 9 argentino, hay que sacarlo.
 *
 * Era falso. Lo que pasaba es que ese número estaba cargado SIN el 9 en la
 * lista de destinatarios de prueba del número de Meta, y esa lista se compara
 * **literal**: `543571684980` y `5493571684980` son dos entradas distintas.
 * Sacarle el 9 acertaba por casualidad.
 *
 * Se vio al probar con un segundo teléfono, cargado solo con el 9: dejaron de
 * funcionar las dos puntas a la vez — no se le podía contestar al cliente ni
 * avisarle al dueño, las dos con el mismo error engañoso sobre la lista.
 *
 * Así que no se toca el número. El `wa_id` es el identificador que Meta mismo
 * usa para esa conversación, y el del dueño lo escribe una persona que está
 * mirando cuál aceptó Meta. Y todo esto es un artefacto del número de prueba:
 * en producción esa lista no existe.
 */

/**
 * Pasa un número al formato del campo `to` de la Cloud API: solo dígitos, sin
 * "+", sin espacios ni guiones. No reinterpreta prefijos.
 *
 * @param {string} numero en cualquier formato (E.164, con espacios, guiones…)
 * @returns {string} solo dígitos; '' si la entrada es basura
 */
function aDestinatario(numero) {
  return String(numero || '').replace(/\D/g, '');
}

module.exports = {
  aDestinatario,
};
