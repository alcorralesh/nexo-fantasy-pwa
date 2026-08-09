# Sistema de puntuación de jugadores

## Dependencia del proveedor

El catálogo de estadísticas puntuables procede de las capacidades reales de la API elegida. Cada regla referencia el campo técnico del proveedor y solo puede activarse si ese campo está disponible para la competición y temporada. La interfaz no permite crear una estadística que el proveedor no pueda entregar.

## Flujo de cálculo

Cuando la API marca un partido como finalizado, el backend almacena una copia de sus estadísticas normalizadas. Después aplica la versión de reglas vigente al comenzar la jornada y genera un desglose por jugador. El total del once se obtiene exclusivamente de los jugadores incluidos en el snapshot cerrado de la alineación.

Cada cálculo conserva partido, jugador, posición utilizada, estadísticas originales, versión de reglas, líneas del desglose, multiplicadores y total. Esto permite reproducir el resultado y recalcularlo si el proveedor publica una corrección.

## Versionado

Los cambios administrativos crean una nueva versión y nunca modifican retrospectivamente una jornada cerrada. Una corrección del proveedor utiliza la versión histórica asociada a esa jornada. La publicación del recálculo debe ser atómica para todas las ligas afectadas.

## Presentación

El total aparece en la ficha del jugador, en la alineación cerrada y en la sección Jornada. La ficha muestra además cada estadística, su valor recibido y los puntos aportados. Durante el partido solo se muestra su estado; los puntos permanecen pendientes hasta la confirmación final del proveedor.

## Copias de jornada y borradores

Al comenzar el primer partido, el backend convierte el borrador en un snapshot inmutable con plantilla, once, formación, capitán y versión de reglas. Ese snapshot es la única fuente utilizada para puntuar. Simultáneamente se crea el borrador de la jornada siguiente a partir de la última alineación válida y de la propiedad actual de los jugadores.

Las operaciones posteriores no alteran snapshots: una venta conserva al jugador en la jornada cerrada, pero lo elimina de borradores futuros; un fichaje solo queda disponible para la siguiente jornada abierta. La interfaz expone snapshots históricos en modo consulta y un único borrador editable.
