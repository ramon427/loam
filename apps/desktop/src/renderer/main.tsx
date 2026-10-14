import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { followSystemTheme } from "./lib/theme";
import { applyAppearance } from "./themes/appearance";
import { installCustomizations } from "./themes/customizations";

import { App } from "./App";
import { installAutomation } from "./automation";

// Lets the styles leave room for each platform's window buttons.
document.documentElement.dataset.platform = window.loam.platform;
followSystemTheme();
applyAppearance();
installCustomizations();
installAutomation();

const root = document.getElementById("root");
if (!root) throw new Error("The app root element is missing.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
