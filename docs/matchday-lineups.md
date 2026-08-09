# Contrato de alineaciones por jornada

## Identidad

Cada alineación pertenece de forma conjunta a una participación, una liga y una jornada. Nunca se comparte automáticamente entre ligas aunque utilicen la misma identidad de equipo.

## Validaciones del servidor

- La participación pertenece al usuario autenticado y está activa.
- La jornada acepta cambios y su fecha límite todavía no ha pasado.
- Hay exactamente 11 identificadores distintos.
- Todos los jugadores pertenecen a la plantilla vigente de esa participación.
- La distribución cumple la formación elegida: 1 POR, 3-5 DEF, 3-5 MED y 1-3 DEL.
- El capitán forma parte del once titular.
- Ningún jugador suspendido administrativamente puede alinearse.

## Cambio de formación

El servidor nunca propone ni añade futbolistas por su cuenta. El cliente conserva el once actual y envía de forma explícita los identificadores retirados y añadidos. Cuando una formación reduce una línea, el usuario debe escoger primero qué titulares salen. Después elige desde su propia plantilla los jugadores que completan las líneas que aumentan. El resultado vuelve a validarse como un once completo antes de guardarlo.

## Guardado y cierre

El navegador envía la formación, los once titulares ordenados, el capitán y una clave de idempotencia. El servidor valida y guarda un borrador versionado. Cuando vence el plazo, una tarea del backend crea un `lineup_snapshot` inmutable dentro de una transacción.

La restricción recomendada es `UNIQUE (participation_id, matchday_id)` para el borrador activo y `UNIQUE (participation_id, matchday_id, player_id)` para los jugadores del snapshot. Las peticiones repetidas con la misma clave deben devolver la misma versión.

Si no existe un borrador válido, el servidor intenta copiar la última alineación cerrada, eliminando jugadores que ya no pertenezcan a la plantilla. Si después de validarla no quedan 11 jugadores compatibles, la participación queda sin alineación y no se inventan sustitutos.

## Ficha del jugador y recomendaciones

La ficha inferior es una vista de cliente: reúne la información del jugador, su valor global de mercado, estadísticas sencillas y el siguiente encuentro sincronizado desde el calendario de su competición. La condición de local o visitante se obtiene del partido oficial; no se deduce ni se inventa si el calendario todavía no está disponible.

Un cambio directo solo puede enviar el identificador de un titular y el de un jugador de la misma posición que ya pertenezca al banquillo de esa participación. El servidor vuelve a validar propiedad, posición, jornada y cierre antes de aceptarlo.

El recomendador puede comparar jugadores compatibles del banquillo y del mercado. Su resultado es orientativo y no modifica estado. Si recomienda un futbolista del mercado, el usuario debe completar primero la operación de fichaje según las reglas de la liga. Solo después de que el backend confirme la nueva propiedad podrá alinearlo.

## Visibilidad para rivales

La plantilla vigente puede ser pública dentro de la liga, pero el borrador de la próxima jornada nunca se entrega a otros participantes. Antes del cierre, la vista de un rival utiliza el último `lineup_snapshot` ya cerrado. Después del cierre de la jornada actual, el nuevo snapshot puede hacerse visible con su formación y capitán.

Las respuestas públicas deben excluir el saldo, las pujas y ofertas pendientes, las cláusulas protegidas y cualquier acción de mercado que todavía no esté confirmada. Esta separación debe aplicarse en el servidor y no limitarse a ocultar campos en la interfaz.
