import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./lib/posthog"; // initialise PostHog early

createRoot(document.getElementById("root")!).render(<App />);
