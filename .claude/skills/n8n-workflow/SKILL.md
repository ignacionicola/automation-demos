---
name: n8n-workflow
description: Genera y valida workflows de n8n en formato JSON importable. 
  Usar cuando se pida crear, modificar o revisar un workflow de n8n.
---

Al generar un workflow de n8n:
1. El JSON debe ser importable directo (estructura nodes[] + connections{}).
2. Usá nombres de nodo descriptivos en inglés, no "HTTP Request1".
3. Credenciales siempre por variable de entorno, nunca hardcodeadas.
4. Incluí manejo de error explícito en cada nodo que llame a una API externa.
5. Después de generar, listá qué credenciales hay que configurar en n8n.
6. Agregá nodos Sticky Note explicando cada bloque del flujo — 
   esto es material de portfolio, tiene que leerse solo.
