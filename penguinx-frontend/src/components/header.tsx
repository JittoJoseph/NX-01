"use client";

import { useState, useEffect } from "react";

export function Header() {
  const [time, setTime] = useState<Date | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setTime(new Date());
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Don't render time until after hydration to prevent mismatch
  if (!mounted || !time) {
    return (
      <header className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b border-border/40">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold font-mono tracking-widest text-foreground">
              PENGUINX
            </h1>
            <span className="text-xs font-mono text-muted-foreground hidden sm:block">
              MARKET SIMULATION ENGINE
            </span>
          </div>
          <div className="text-xs font-mono text-muted-foreground tabular-nums">
            Loading...
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b border-border/40">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold font-mono tracking-widest text-foreground">
            PENGUINX
          </h1>
          <span className="text-xs font-mono text-muted-foreground hidden sm:block">
            MARKET SIMULATION ENGINE
          </span>
        </div>
        <div className="text-xs font-mono text-muted-foreground tabular-nums">
          <span className="hidden sm:inline">
            {time.toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}{" "}
          </span>
          {time.toLocaleTimeString("en-US", { hour12: false })}
        </div>
      </div>
    </header>
  );
}
