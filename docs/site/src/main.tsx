import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { applySavedTheme } from "./hooks/useTheme";
import "./index.css";
import "./styles/factory.css";
import "./styles/tour.css";
import "./styles/minimal.css";

applySavedTheme();

// This app mounts afresh; React then owns the metadata emitted during prerendering.
document.head.querySelectorAll("[data-prerendered-head]").forEach((element) => element.remove());
createRoot(document.getElementById("root")!).render(<App />);
