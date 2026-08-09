# Operaciones sobre jugadores propios

## Alcance

La ficha contractual se abre desde los jugadores del banquillo de una participación. La ficha de un titular se mantiene separada y solo gestiona alineación, sustituciones y capitanía. Esta separación evita ejecutar accidentalmente una venta mientras se prepara el once.

## Cláusula, mercado y blindaje

La cláusula pertenece al jugador dentro de una participación concreta. Cualquier aumento debe validar el coste configurado y el saldo antes de guardarse. Poner al jugador en venta permite recibir ofertas confirmables, pero no transfiere la propiedad por sí solo.

Al activarse la venta, el backend crea un anuncio visible para todos los participantes de la misma liga y el jugador queda marcado en el banquillo del propietario. El propietario puede gestionar o retirar el anuncio, pero nunca pujar sobre él desde su propia participación. Los demás usuarios lo reciben como un elemento pujable del mercado.

Durante cada renovación, un proceso puede generar ofertas automáticas del juego sobre anuncios activos. La configuración administrativa debe controlar probabilidad, margen respecto al valor y límites. Estas ofertas requieren aceptación expresa y no pueden transferir jugadores automáticamente.

## Ofertas recibidas

Cada oferta conserva importe, origen, participante ofertante, fecha de creación, fecha de vencimiento y estado. Las ofertas de rivales vencen 24 horas después de crearse. Las ofertas automáticas del juego vencen al comenzar la siguiente renovación del mercado.

Las mismas ofertas se exponen en dos vistas: la ficha contractual del jugador y el apartado agregado de Ofertas dentro del mercado. Ambas consumen los mismos registros y acciones; aceptar o rechazar en una vista debe reflejarse inmediatamente en la otra.

El apartado Ofertas se divide en «Recibidas» y «Hechas». En recibidas, el jugador se presenta una sola vez y sus propuestas se agrupan debajo, aunque procedan de varios rivales y del juego. Así se evita duplicar visualmente al futbolista sin perder el detalle individual de cada oferta.

Desde la plantilla pública de un rival se puede seleccionar cualquiera de sus jugadores y crear una oferta directa. Las ofertas hechas duran 24 horas, son privadas y retienen su importe dentro del límite económico compartido con las pujas. Mientras estén activas pueden modificarse o eliminarse; una modificación reinicia el plazo de 24 horas y una eliminación libera la retención. El servidor debe volver a validar saldo, propiedad y vigencia en todas estas operaciones.

El propietario puede aceptar o rechazar una oferta vigente. La aceptación debe ejecutarse en una transacción que bloquee al jugador y las ofertas activas, vuelva a validar propiedad y vencimiento, transfiera el jugador, abone el importe y marque como rechazadas todas las demás ofertas. Así se impide aceptar dos propuestas simultáneamente desde dispositivos distintos.

Se recomienda una clave de idempotencia para la respuesta y una restricción que impida más de una oferta aceptada por jugador y ciclo de propiedad. Las ofertas vencidas se marcan como tales mediante la renovación o al consultarse y nunca pueden reactivarse.

El blindaje tiene inicio y vencimiento y bloquea clausulazos mientras esté activo. El estado «intocable» es únicamente una preferencia del usuario y no tiene efectos transaccionales.

## Clausulazos entre participantes

Un participante puede adquirir directamente un jugador rival pagando íntegramente su cláusula, sin oferta previa ni aceptación del propietario. La operación solo está abierta hasta 24 horas antes del primer partido de la jornada y se bloquea si existe un blindaje vigente.

El servidor debe bloquear la propiedad del jugador, comprobar de nuevo el plazo, blindaje, saldo real y límite de plantilla, descontar el importe y transferir al jugador en una sola transacción. Una restricción de propiedad exclusiva impide que dos clausulazos simultáneos tengan éxito. Las ofertas activas del comprador sobre ese jugador se cancelan y liberan su retención al completarse la compra.

## Venta inmediata

La venta inmediata paga por defecto el 50% del valor global vigente. El servidor debe comprobar que el jugador sigue siendo propiedad del usuario, que pertenece al banquillo y que no existe otra transferencia ya confirmada. La retirada del jugador y el abono se ejecutan dentro de la misma transacción y con una clave de idempotencia.

Si el jugador forma parte de un snapshot ya cerrado, su venta no altera esa alineación ni sus puntos. Los borradores futuros deben volver a validarse. Las ligas fantásticas omiten cláusulas, blindajes y ofertas entre propietarios porque sus catálogos permiten jugadores repetidos.
