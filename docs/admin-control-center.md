# Centro de control administrativo

## Alcance

El superadministrador puede consultar usuarios, equipos, ligas, participaciones, plantillas, mercados, anuncios, pujas, ofertas, blindajes, transferencias y actividad. El acceso administrativo a una liga no crea una participación, no ocupa una plaza y no asigna jugadores.

## Operaciones sobre ligas y mercados

Entrar como administrador permite usar las operaciones disponibles en la liga con permisos elevados. La renovación manual debe ejecutar exactamente el mismo servicio que la tarea programada: cerrar la ventana, volver a validar saldo y propiedad, resolver pujas con bloqueo transaccional, generar las ofertas automáticas configuradas y abrir la siguiente ventana.

La renovación recibe una clave de idempotencia. Dos solicitudes simultáneas para la misma liga y ventana no pueden adjudicar jugadores ni generar ofertas dos veces. El resultado registra contadores, incidencias y la identidad del administrador.

## Catálogo de jugadores

Las modificaciones se guardan como versiones. Los datos nuevos se aplican al catálogo vigente, mientras que alineaciones, jornadas y operaciones históricas conservan la versión utilizada cuando se confirmaron. Los cambios de valor se publican de forma global y atómica.

## Auditoría y permisos

Cada operación administrativa registra administrador, fecha, motivo, dirección IP o sesión, entidad afectada, valores anteriores y posteriores y resultado. Los registros no se editan desde la interfaz ordinaria.

Los permisos se validan en el servidor para cada lectura y escritura. Las acciones especialmente sensibles —cambiar propiedad, saldo, resultados o resolver mercados— deben admitir autorización reforzada y motivo obligatorio. La interfaz nunca sustituye estas comprobaciones.
