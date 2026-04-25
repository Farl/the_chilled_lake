import { jsxDEV } from "react/jsx-dev-runtime";
import React from "react";
import { createRoot } from "react-dom/client";
import WaterSimulation from "./WaterSimulation.jsx";
const rootEl = document.getElementById("app");
const defaultConfig = {
  damping: 0.985,
  dropRadius: 0.03,
  dropStrength: 0.6,
  refractionScale: 0.04,
  reflectionStrength: 0.5,
  autoRain: true,
  rainIntensity: 0.03
};
const App = () => {
  React.useEffect(() => {
    const audio = new Audio("/chill_ambient_loop.mp3");
    audio.loop = true;
    audio.preload = "auto";
    audio.playsInline = true;
    audio.load();
    const tryPlay = (reason) => {
      audio.play().then(() => {
        console.log("[bgm] playing (reason:", reason, ")");
      }).catch((err) => {
        console.warn("[bgm] play blocked (reason:", reason, "):", err);
      });
    };
    tryPlay("autoplay");
    const resumeOnInteraction = () => {
      tryPlay("user-gesture");
    };
    window.addEventListener("pointerdown", resumeOnInteraction, { once: true });
    window.addEventListener("touchstart", resumeOnInteraction, { once: true });
    window.addEventListener("click", resumeOnInteraction, { once: true });
    window.addEventListener("keydown", resumeOnInteraction, { once: true });
    return () => {
      audio.pause();
      audio.src = "";
      window.removeEventListener("pointerdown", resumeOnInteraction);
      window.removeEventListener("touchstart", resumeOnInteraction);
      window.removeEventListener("click", resumeOnInteraction);
      window.removeEventListener("keydown", resumeOnInteraction);
    };
  }, []);
  return /* @__PURE__ */ jsxDEV(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        touchAction: "none",
        cursor: "crosshair"
      },
      children: /* @__PURE__ */ jsxDEV(WaterSimulation, { config: defaultConfig }, void 0, false, {
        fileName: "<stdin>",
        lineNumber: 71,
        columnNumber: 7
      })
    },
    void 0,
    false,
    {
      fileName: "<stdin>",
      lineNumber: 63,
      columnNumber: 5
    }
  );
};
createRoot(rootEl).render(/* @__PURE__ */ jsxDEV(App, {}, void 0, false, {
  fileName: "<stdin>",
  lineNumber: 76,
  columnNumber: 27
}));
