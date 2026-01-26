import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "./styles/theme.css";
import "./styles/global.css";

const resolveInitialTheme = () => {
  if (typeof window === "undefined") {
    return "light";
  }
  try {
    const stored = window.localStorage.getItem("wa-admin-theme");
    if (stored === "dark" || stored === "light") {
      return stored;
    }
  } catch {
    // ignore storage errors
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

document.documentElement.setAttribute("data-theme", resolveInitialTheme());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
