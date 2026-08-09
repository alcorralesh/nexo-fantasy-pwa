# Nexo Fantasy

Aplicación Fantasy de fútbol diseñada primero para móvil y tablet.

## Estado actual

La primera versión es un prototipo navegable con datos de demostración. Incluye:

- Inicio y resumen de jornada.
- Varios equipos por usuario.
- Selector de Primera, Segunda y Liga F.
- Alineación visual sobre el campo.
- Mercado con búsqueda, posiciones y pujas simuladas.
- Ligas públicas, privadas con código y fantásticas.
- Perfil, monedas simuladas y logros.
- Panel inicial de administración.
- Indicador del consumo diario de la futura API deportiva.
- Instalación como PWA en móvil y tablet, con iconos, splash, modo independiente, actualización y pantalla sin conexión.

Todavía no hay base de datos, cuentas reales ni conexión con una API deportiva.

## Versión publicada

La PWA se publica en GitHub Pages en:

https://alcorralesh.github.io/nexo-fantasy-pwa/

Cada cambio enviado a la rama `main` genera y publica automáticamente una nueva versión mediante GitHub Actions.

## Desarrollo local

Requiere Node.js 22.13 o posterior y pnpm.

```bash
pnpm install
pnpm dev
```

La aplicación estará disponible normalmente en `http://localhost:3000`.

## Probar como aplicación móvil

La instalación PWA necesita una dirección HTTPS cuando se abre desde otro dispositivo. Una vez publicada:

- Android/Chrome: abre la web y pulsa `Instalar Nexo`.
- iPhone/iPad/Safari: pulsa Compartir y elige `Añadir a pantalla de inicio`.
- Escritorio/Chrome o Edge: utiliza el icono de instalación de la barra de direcciones.

El manifest está en `public/manifest.webmanifest`, el modo sin conexión en `public/sw.js` y los recursos gráficos en `public/pwa`. Pueden regenerarse manteniendo la identidad visual con:

```bash
python scripts/generate-pwa-assets.py
```

Para comprobar la versión de producción:

```bash
pnpm build
```

## Próximas fases

1. Definir formalmente reglas, economía y sistemas de puntuación.
2. Diseñar la base de datos y el sistema de usuarios.
3. Implementar equipos, ligas y mercados persistentes.
4. Conectar una fuente gratuita de datos con almacenamiento en caché.
5. Añadir sincronización posterior a cada partido y recálculo de jornadas.
