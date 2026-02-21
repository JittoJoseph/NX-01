"use client";

import { useSystemStatus } from "@/lib/hooks";
import type { SystemStats } from "@/lib/types";

export function SystemStatusIndicator({
  stats,
}: {
  stats?: SystemStats | null;
}) {
  const { backendActive, wsConnected } = useSystemStatus();

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-sm border-t border-border/40">
      <div className="container mx-auto px-4 py-2 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div
              className={`w-1.5 h-1.5 rounded-full ${backendActive ? "bg-emerald-500" : "bg-red-500"}`}
            />
            <span>{backendActive ? "BACKEND ACTIVE" : "BACKEND OFFLINE"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div
              className={`w-1.5 h-1.5 rounded-full ${wsConnected ? "bg-emerald-500" : "bg-amber-500"}`}
            />
            <span>{wsConnected ? "WS CONNECTED" : "WS DISCONNECTED"}</span>
          </div>
        </div>
        {stats && (
          <div className="flex items-center gap-4">
            <span>TRADES: {stats.database.totalTrades}</span>
            <span>MARKETS: {stats.database.activeMarkets}</span>
            <span>UPTIME: {formatUptime(stats.uptimeSeconds)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
