# Resolución de pujas del mercado

## Creación y modificación

Cada puja pertenece a una participación, una liga, un jugador y una ventana de mercado. El servidor exige que la ventana esté abierta, que el jugador esté disponible y que el importe sea igual o superior a su valor de mercado vigente. Una participación solo puede tener una puja activa por jugador y ventana.

La suma de importes comprometidos no puede superar el saldo más el porcentaje de deuda configurado. Con un saldo de 10 M y una deuda máxima del 20%, el compromiso total permitido es 12 M. Las modificaciones reutilizan el registro activo y deben ser idempotentes.

Registrar una puja crea una retención por su importe, pero no modifica todavía el saldo real. La interfaz muestra ambas cantidades por separado. En la resolución se consolida únicamente la retención ganadora y se descuenta del saldo real; todas las retenciones perdedoras o invalidadas se liberan.

## Plazas de plantilla

El número máximo de jugadores en el banquillo es configurable y parte de 20. El cliente limita el número de pujas que podrían ganarse simultáneamente, pero el servidor vuelve a comprobar el límite en el momento de la resolución.

## Renovación

Cada liga crea ventanas consecutivas de 24 horas por defecto. Una tarea del backend bloquea la ventana vencida y procesa cada jugador dentro de una transacción. Las pujas se ordenan de mayor a menor importe. En caso de empate se recomienda priorizar la puja válida registrada primero.

Antes de adjudicar se vuelven a validar saldo, deuda, propiedad del jugador y plazas disponibles. Si la primera oferta ya no es válida, se evalúa la siguiente. El ganador recibe al jugador y el importe se descuenta de forma atómica. Las pujas perdedoras se liberan sin cargo.

La restricción recomendada es `UNIQUE (market_window_id, participation_id, player_id)`. La adjudicación debe utilizar bloqueos de fila o una estrategia serializable para impedir dos propietarios simultáneos en ligas de jugadores exclusivos.
