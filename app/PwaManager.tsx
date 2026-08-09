"use client";

import { useEffect, useState } from "react";
import { appBasePath } from "./base-path";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaManager() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [updateWorker, setUpdateWorker] = useState<ServiceWorker | null>(null);
  const [offline, setOffline] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [installCompact, setInstallCompact] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (window.navigator as Navigator & { standalone?: boolean }).standalone;
    const previouslyDismissed = window.localStorage.getItem("nexo_pwa_install_dismissed") === "1";
    setDismissed(Boolean(standalone) || previouslyDismissed);
    setOffline(!window.navigator.onLine);

    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => { setInstallPrompt(null); setShowIosHelp(false); setDismissed(true); };
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    if (isIos && !standalone && !previouslyDismissed) setShowIosHelp(true);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(`${appBasePath}/sw.js`, { scope: `${appBasePath}/` }).then((registration) => {
        if (registration.waiting) setUpdateWorker(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setUpdateWorker(worker);
          });
        });
      }).catch(() => { /* La web sigue funcionando aunque el navegador no admita instalación. */ });
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (dismissed || (!installPrompt && !showIosHelp)) return;
    const timer = window.setTimeout(() => setInstallCompact(true), 6000);
    return () => window.clearTimeout(timer);
  }, [dismissed, installPrompt, showIosHelp]);

  useEffect(() => {
    document.documentElement.classList.toggle("pwa-install-compact", installCompact);
    return () => document.documentElement.classList.remove("pwa-install-compact");
  }, [installCompact]);

  function dismiss() {
    window.localStorage.setItem("nexo_pwa_install_dismissed", "1");
    setDismissed(true);
    setShowIosHelp(false);
  }

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setDismissed(true);
    setInstallPrompt(null);
  }

  function update() {
    updateWorker?.postMessage({ type: "SKIP_WAITING" });
  }

  return <>
    {offline && <div className="pwa-connectivity" role="status"><span /> Sin conexión · usando la versión guardada</div>}
    {updateWorker && <aside className="pwa-update-card" role="status"><span>N</span><p><strong>Nueva versión disponible</strong><small>Actualiza para utilizar las últimas mejoras.</small></p><button onClick={update}>Actualizar</button></aside>}
    {!dismissed && (installPrompt || showIosHelp) && <aside className="pwa-install-card" aria-label="Instalar Nexo"><button className="pwa-install-close" onClick={dismiss} aria-label="Cerrar">×</button><span>N</span><div><small>APP PARA MÓVIL Y TABLET</small><strong>Instala Nexo</strong><p>{showIosHelp ? "Pulsa Compartir y después «Añadir a pantalla de inicio»." : "Acceso directo, pantalla completa y soporte sin conexión."}</p></div>{installPrompt && <button className="pwa-install-button" onClick={install}>Instalar</button>}</aside>}
  </>;
}
