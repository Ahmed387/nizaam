import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { initOfflineSync } from "@/lib/offlineQueue";

initOfflineSync();

// Reload once when a lazily-loaded file is gone after a new deploy (stale chunk cache).
const CHUNK_KEY = "nizam-chunk-reload";
const isChunkError = (m: unknown) => /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically imported module/i.test(String(m ?? ""));
const reloadOnce = () => {
  const last = Number(sessionStorage.getItem(CHUNK_KEY) || 0);
  if (Date.now() - last < 10_000) return;
  sessionStorage.setItem(CHUNK_KEY, String(Date.now()));
  window.location.reload();
};
window.addEventListener("vite:preloadError", (e) => { e.preventDefault(); reloadOnce(); });
window.addEventListener("unhandledrejection", (e) => { if (isChunkError((e.reason as any)?.message ?? e.reason)) reloadOnce(); });
window.addEventListener("error", (e) => { if (isChunkError(e.message)) reloadOnce(); });

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>,
);
