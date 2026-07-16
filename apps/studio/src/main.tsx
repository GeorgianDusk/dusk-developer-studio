import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { StudioErrorBoundary } from "./app/ErrorBoundary";
import "./styles/app.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found.");
}

createRoot(root).render(
  <React.StrictMode>
    <StudioErrorBoundary><App /></StudioErrorBoundary>
  </React.StrictMode>
);
