# Algoritmo global de valores de mercado

## Principio

Existe un registro de valor por `player_id`, temporada y marca de tiempo. Las ligas consultan ese registro común y nunca mantienen una copia editable propia. Cada publicación crea una versión histórica para construir gráficas y auditar cambios.

## Señales agregadas

- Demanda: usuarios únicos que intentan fichar o añadir al jugador respecto a sus apariciones disponibles.
- Altas netas: incorporaciones confirmadas menos ventas o descartes confirmados.
- Prima de pujas: mediana porcentual pagada sobre el valor vigente, limitada para eliminar extremos.
- Confianza: número de ligas activas y usuarios distintos que forman la muestra.

No cuentan operaciones canceladas, acciones administrativas, cuentas de demostración, repeticiones de un usuario sobre el mismo jugador dentro de la ventana ni ligas marcadas como no computables.

## Fórmula

Cada señal se normaliza dentro de su competición. La presión es:

`presión = peso_demanda × z_demanda + peso_altas × z_altas_netas + peso_prima × prima_limitada`

La variación se suaviza mediante `tanh`, se multiplica por la sensibilidad y la confianza de la muestra, y se limita al máximo configurado:

`variación_% = limitar(tanh(presión) × sensibilidad × confianza, -máximo, +máximo)`

El nuevo valor respeta el mínimo global y se redondea al escalón configurado.

## Publicación segura

Un proceso periódico toma un bloqueo de versión, agrega eventos hasta una marca temporal cerrada, calcula todos los jugadores y escribe la nueva versión dentro de una transacción. La versión solo pasa a activa si el lote completo termina. Repetir el mismo lote devuelve el mismo resultado mediante una clave de idempotencia.

## Parámetros administrables

- Ventana de actividad.
- Pesos de demanda, altas netas y prima de pujas.
- Sensibilidad.
- Variación máxima por lote.
- Número mínimo de ligas distintas.
- Valor mínimo y escalón de redondeo.
- Frecuencia de publicación.
- Tipos de liga computables.
- Congelación global o por competición.

Cada cambio de configuración debe crear una versión con autor, fecha y motivo. Nunca se reescribe el histórico ya publicado.

