"use client";

import { useMemo, useState } from "react";

export function PulseTimeline() {
  const [misses, setMisses] = useState(3);
  const cells = useMemo(
    () => Array.from({ length: misses }, (_, index) => index + 1),
    [misses],
  );

  return (
    <section className="timeline-card" aria-label="Example check-in schedule">
      <div className="timeline-head">
        <div>
          <p className="eyebrow">A SIMPLE EXAMPLE</p>
          <h2>Check in every 30 days. Allow {misses} missed check-ins.</h2>
          <p aria-live="polite" aria-atomic="true">Your handoff becomes available after {misses * 30} days without a successful check-in.</p>
        </div>
        <label>
          Misses allowed
          <select value={misses} onChange={(event) => setMisses(Number(event.target.value))}>
            {[1, 2, 3, 4, 5, 6].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="signal-track">
        <div className="signal-origin">
          <strong>Checked in</strong>
          <small>Today</small>
        </div>
        <div className="track-line" />
        {cells.map((cell) => (
          <div className={`signal-cell ${cell === misses ? "release" : ""}`} key={cell}>
            <span>{cell === misses ? "Handoff available" : `Missed check-in ${cell}`}</span>
            <small>Day {cell * 30}</small>
          </div>
        ))}
      </div>
      <p className="timeline-note">
        Check in at any time before the final date and the full schedule starts over.
        Missing one date does not move or release anything by itself.
      </p>
    </section>
  );
}
