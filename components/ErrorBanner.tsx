"use client";

import { useEffect, useRef } from "react";

export function ErrorBanner({ message }: { message: string }) {
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const banner = bannerRef.current;
      if (!banner) return;
      banner.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "center",
      });
      banner.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [message]);

  return (
    <div ref={bannerRef} className="error-banner" role="alert" tabIndex={-1}>
      {message}
    </div>
  );
}
