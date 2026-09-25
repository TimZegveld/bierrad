import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LocalSessionController } from "./sessions/LocalSessionController";
import { ManualParticipantSource } from "./services/ManualParticipantSource";
import "./styles.css";

// Composition root: future remote sessions replace this wiring, not the React views.
const source = new ManualParticipantSource();
const controller = new LocalSessionController({
  source,
  saveParticipants: (people) => source.save(people),
});
void controller.initialize();
if (import.meta.hot) import.meta.hot.dispose(() => controller.dispose());
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App controller={controller} />
  </React.StrictMode>,
);
