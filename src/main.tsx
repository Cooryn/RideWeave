/// <reference types="vite/client" />
import "./webviewCompatibility";
import React from "react";
import ReactDOM from "react-dom/client";
import maplibregl from "maplibre-gl";
import mapWorkerUrl from "./mapWorker?worker&url";
import { android } from "./storage";
import App from "./App";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import "./android.css";

if (android) maplibregl.setWorkerUrl(mapWorkerUrl);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
