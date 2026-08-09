import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaManager } from "./PwaManager";
import { appBasePath, withBasePath } from "./base-path";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: "Nexo Fantasy",
  description: "Tu fútbol, tus equipos, tus reglas.",
  applicationName: "Nexo Fantasy",
  manifest: withBasePath("/manifest.webmanifest"),
  icons: {
    icon: [{ url: withBasePath("/pwa/icon-192.png"), sizes: "192x192", type: "image/png" }, { url: withBasePath("/pwa/icon-512.png"), sizes: "512x512", type: "image/png" }],
    apple: [{ url: withBasePath("/pwa/apple-touch-icon.png"), sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Nexo" },
  formatDetection: { telephone: false },
  openGraph: {
    title: "Nexo Fantasy",
    description: "Tu fútbol. Tus equipos. Tus reglas.",
    images: [{ url: "/og.png", width: 1734, height: 909 }],
    locale: "es_ES",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Nexo Fantasy",
    description: "Tu fútbol. Tus equipos. Tus reglas.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#101a12",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <head>
        <meta name="nexo-base-path" content={appBasePath} />
        <link rel="apple-touch-startup-image" href={withBasePath("/pwa/splash-1170x2532.png")} media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href={withBasePath("/pwa/splash-1290x2796.png")} media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href={withBasePath("/pwa/splash-2048x2732.png")} media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body>{children}<PwaManager /></body>
    </html>
  );
}
