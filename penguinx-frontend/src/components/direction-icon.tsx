"use client";

import { cn } from "@/lib/utils";
import { Minus } from "lucide-react";
import type { Direction } from "@/lib/types";

interface DirectionIconProps {
  direction: Direction;
}

export function DirectionIcon({ direction }: DirectionIconProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center w-5 h-5 rounded-full",
        direction === "up" && "bg-emerald-500/20 text-emerald-500",
        direction === "down" && "bg-red-500/20 text-red-500",
        direction === "flat" && "bg-muted text-muted-foreground",
      )}
    >
      {direction === "up" && (
        <svg
          className="h-3 w-3 fill-current"
          viewBox="0 0 12 12"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M6 2L10 10H2L6 2Z" />
        </svg>
      )}
      {direction === "down" && (
        <svg
          className="h-3 w-3 fill-current"
          viewBox="0 0 12 12"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M6 10L2 2H10L6 10Z" />
        </svg>
      )}
      {direction === "flat" && <Minus className="h-3 w-3" />}
    </div>
  );
}
