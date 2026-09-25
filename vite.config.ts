import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode, command }) => {
  const dev = command === "serve";
  const api =
    process.env.VITE_API_URL ??
    loadEnv(mode, process.cwd(), "VITE_").VITE_API_URL;
  let backend = "";
  if (api) {
    const url = new URL(api);
    const local =
      dev &&
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !local) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      throw new Error(
        "VITE_API_URL must be a public HTTPS origin (loopback HTTP is development-only).",
      );
    }
    backend = `${url.origin} ${url.origin.replace(/^http/, "ws")}`;
  }
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'none'",
    `script-src 'self'${dev ? " 'unsafe-inline'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    `connect-src 'self' ${backend}${dev ? " ws://127.0.0.1:* ws://localhost:*" : ""}`,
  ].join("; ");
  return {
    base: "./",
    plugins: [
      react(),
      {
        name: "bierrad-privacy-headers",
        transformIndexHtml: () => [
          {
            tag: "meta",
            attrs: { "http-equiv": "Content-Security-Policy", content: csp },
            injectTo: "head-prepend",
          },
        ],
      },
    ],
  };
});
