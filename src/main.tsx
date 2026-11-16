import { useState } from "react";
import { createRoot } from "react-dom/client";
import SeatSmartHero from "./components/SeatSmartHero";
import type { HeroVariant } from "./components/seat-smart-hero/scene";

// Preview only: a switch to compare the two room styles.
function Preview() {
  const [variant, setVariant] = useState<HeroVariant>(location.hash === "#daylight" ? "daylight" : "model");
  return (
    <>
      <div className="pv-switch" role="group" aria-label="Room style">
        {(["model", "daylight"] as HeroVariant[]).map((v) => (
          <button key={v} id={`pv-${v}`} aria-pressed={variant === v} onClick={() => setVariant(v)}>
            {v === "model" ? "Architectural model" : "Daylight venue"}
          </button>
        ))}
      </div>
      <SeatSmartHero variant={variant} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
