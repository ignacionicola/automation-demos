/**
 * Normalización de números para la WhatsApp Cloud API.
 *
 * Por qué existe: Meta usa dos formatos distintos para el mismo teléfono, y
 * mezclarlos rompe el envío. En los mensajes entrantes el webhook entrega el
 * `wa_id` de un celular argentino CON el 9 de móvil (549XXXXXXXXXX), pero
 * `POST /{phone-number-id}/messages` rechaza exactamente ese número con
 * `(#131030) Recipient phone number not in allowed list` — aunque el número
 * esté agregado y verificado en la lista de destinatarios. Hay que mandarlo
 * SIN el 9 (54XXXXXXXXXX).
 *
 * Verificado contra la API real: enviando a `543511234567` el mensaje sale, y
 * el webhook de estado vuelve con `recipient_id: "5493511234567"` — o sea que
 * Meta normaliza de vuelta a la forma con 9 por su cuenta. El error es
 * engañoso: parece un problema de permisos, pero es de formato.
 */

// El dígito que va entre el código de país y el área para indicar "móvil", y
// que la Cloud API no acepta en el destinatario. Solo se listan los países
// verificados contra la API; el resto de los números pasan sin tocar.
const PREFIJO_MOVIL_POR_PAIS = {
  // Argentina. No hay ambigüedad posible: ningún código de área argentino
  // empieza con 9, así que un número que arranca con 549 es siempre un celular.
  54: '9',
};

function soloDigitos(numero) {
  return String(numero || '').replace(/\D/g, '');
}

/**
 * Pasa un número al formato que espera el campo `to` de la Cloud API: solo
 * dígitos, sin "+" y sin el prefijo de móvil que Meta rechaza.
 *
 * @param {string} numero en cualquier formato (E.164, con espacios, guiones…)
 * @returns {string} solo dígitos, listo para mandar; '' si la entrada es basura
 */
function toWhatsAppRecipient(numero) {
  const digitos = soloDigitos(numero);
  if (!digitos) return '';

  for (const [pais, prefijoMovil] of Object.entries(PREFIJO_MOVIL_POR_PAIS)) {
    const conPrefijo = `${pais}${prefijoMovil}`;
    if (digitos.startsWith(conPrefijo)) {
      return pais + digitos.slice(conPrefijo.length);
    }
  }

  return digitos;
}

module.exports = {
  toWhatsAppRecipient,
};
