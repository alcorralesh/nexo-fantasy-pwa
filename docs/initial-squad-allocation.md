# Reparto seguro de la plantilla inicial

Este documento define el contrato que deberá respetar el backend al conectar la base de datos. La interfaz actual solo simula el proceso en el navegador y no puede garantizar exclusividad entre dispositivos o usuarios reales.

## Reglas del reparto

- Solo el servidor elige los jugadores. El navegador envía la liga, el equipo y una clave de idempotencia, nunca una lista de futbolistas.
- La participación debe pertenecer a la misma competición que el equipo y estar pendiente de reparto.
- Se entregan exactamente 16 jugadores: 2 POR, 5 DEF, 5 MED y 4 DEL.
- El once inicial se crea en 4-4-2: 1 POR, 4 DEF, 4 MED y 2 DEL.
- Los 5 jugadores restantes forman el banquillo.
- El valor total debe estar entre el 90 % y el 110 % del objetivo configurado en la liga.
- Un jugador solo puede pertenecer a un participante dentro de una liga con mercado.
- Si no existe una combinación válida, toda la operación se revierte y no se entrega una plantilla incompleta.

## Transacción recomendada

1. Abrir una transacción de base de datos.
2. Obtener un bloqueo exclusivo para la liga o para su inventario de jugadores.
3. Comprobar la clave de idempotencia. Si la solicitud ya terminó, devolver el mismo reparto sin repetirlo.
4. Bloquear la participación y verificar que aún no tenga una plantilla inicial.
5. Consultar y bloquear los jugadores libres de la competición que pertenecen al inventario de esa liga.
6. Buscar una combinación que cumpla posiciones y margen de valor.
7. Insertar los 16 propietarios y la alineación inicial.
8. Marcar la participación como activa y confirmar la transacción.
9. Si aparece un conflicto de concurrencia, revertir y reintentar un número limitado de veces.

En PostgreSQL puede utilizarse un bloqueo de la fila de la liga con `SELECT ... FOR UPDATE` o un bloqueo transaccional consultivo por `league_id`. Los candidatos también deben bloquearse durante el reparto; `FOR UPDATE SKIP LOCKED` permite evitar jugadores que ya está procesando otra transacción.

## Restricciones obligatorias de base de datos

Estas restricciones son la última barrera de seguridad y no deben depender solo del código:

- `UNIQUE (league_id, player_id)` en la propiedad de jugadores.
- `UNIQUE (participation_id, player_id)` en la plantilla.
- `UNIQUE (participation_id)` en el reparto inicial.
- `UNIQUE (user_id, idempotency_key)` en las solicitudes de reparto.
- Claves foráneas desde plantilla a participación, liga y jugador.
- Comprobaciones de estado para impedir modificaciones de un reparto ya confirmado.

## Respuesta a la interfaz

La API debe devolver el reparto confirmado únicamente después del `COMMIT`. Mientras espera, la interfaz puede mostrar la animación. Si el reparto falla, debe mostrar un error recuperable y nunca inventar una plantilla local.

