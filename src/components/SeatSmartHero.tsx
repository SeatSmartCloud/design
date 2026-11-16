import { useEffect, useRef } from "react";
import { createSeatSmartHero } from "./seat-smart-hero/scene";
import "./seat-smart-hero/seat-smart-hero.css";

interface SeatSmartHeroProps {
  primaryHref?: string;
  secondaryHref?: string;
}

/**
 * Full-width Seat Smart hero: a live 3D gala room that fills itself.
 * Needs the `three` package. Headline font can be set with the
 * `--ssh-serif` CSS variable on any parent element.
 */
export default function SeatSmartHero({
  primaryHref = "/signup",
  secondaryHref = "#how-it-works",
}: SeatSmartHeroProps) {
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stageRef.current) return;
    const hero = createSeatSmartHero(stageRef.current);
    return () => hero.destroy();
  }, []);

  return (
    <section className="ssh-hero" aria-label="Seat Smart">
      <div className="ssh-copy">
        <p className="ssh-eyebrow">A calmer way to seat a room</p>
        <h1 className="ssh-title">Event seating that fills itself.</h1>
        <p className="ssh-sub">
          Guests choose where they sit, you stay in control. Lay out the room,
          send one link, and watch it fill.
        </p>
        <div className="ssh-ctas">
          <a className="ssh-btn ssh-btn-primary" href={primaryHref}>
            Start free
          </a>
          <a className="ssh-btn ssh-btn-ghost" href={secondaryHref}>
            See how it works
          </a>
        </div>
        <p className="ssh-micro">
          No guest sign-up. No app. Works alongside your ticketing or
          registration.
        </p>
      </div>
      <div
        className="ssh-stage"
        ref={stageRef}
        role="img"
        aria-label="A 3D gala dinner room where guests pick their own seats from their phones and the tables fill in real time."
      />
    </section>
  );
}
