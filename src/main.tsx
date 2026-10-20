import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import { App } from "./App";
import { BrowserProvider } from "./BrowserContext";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Xuvon renderer root is missing.");

createRoot(container).render(
  <BrowserProvider>
    <App />
  </BrowserProvider>
);
