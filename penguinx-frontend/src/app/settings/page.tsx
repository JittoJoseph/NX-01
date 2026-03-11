"use client";

import { useState, useCallback, useEffect } from "react";
import { ApiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Header } from "@/components/header";
import { Pause, Play, Trash2 } from "lucide-react";

const api = new ApiClient();

type AdminAction = "pause" | "resume" | "wipe";

const ACTION_CONFIG: Record<
  AdminAction,
  {
    title: string;
    description: string;
    confirmLabel: string;
    destructive: boolean;
  }
> = {
  pause: {
    title: "Pause System",
    description:
      "Stop new trades from being placed. Existing positions will continue to be tracked.",
    confirmLabel: "Pause",
    destructive: false,
  },
  resume: {
    title: "Resume System",
    description:
      "Resume trading operations. The scanner will begin looking for new opportunities.",
    confirmLabel: "Resume",
    destructive: false,
  },
  wipe: {
    title: "Wipe All Data",
    description:
      "Delete all trades, markets, and audit logs. Reset portfolio to initial capital. This cannot be undone.",
    confirmLabel: "Wipe Everything",
    destructive: true,
  },
};

export default function SettingsPage() {
  const [dialogAction, setDialogAction] = useState<AdminAction | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState<boolean | null>(null);

  // Fetch current pause state
  useEffect(() => {
    api
      .getSystemStats()
      .then((s) => setIsPaused(s.orchestrator.paused))
      .catch(() => {});
  }, []);

  const openDialog = useCallback((action: AdminAction) => {
    setDialogAction(action);
    setPassword("");
    setError(null);
    setResult(null);
  }, []);

  const execute = useCallback(async () => {
    if (!dialogAction || !password) return;
    setLoading(true);
    setError(null);
    try {
      if (dialogAction === "pause") {
        const res = await api.pauseSystem(password);
        setIsPaused(res.paused);
        setResult("System paused.");
      } else if (dialogAction === "resume") {
        const res = await api.resumeSystem(password);
        setIsPaused(res.paused);
        setResult("System resumed.");
      } else {
        await api.wipeSystem(password);
        setIsPaused(true);
        setResult("All data wiped. Use Resume to restart.");
      }
      setTimeout(() => setDialogAction(null), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [dialogAction, password]);

  const config = dialogAction ? ACTION_CONFIG[dialogAction] : null;

  return (
    <>
      <Header />
      <main className="container mx-auto px-4 py-8 pb-20 max-w-2xl">
        <h2 className="text-xl font-bold font-mono tracking-wider mb-6">
          SETTINGS
        </h2>

        {/* System status */}
        <Card className="mb-6 bg-zinc-900/60 border-zinc-700/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono tracking-wider text-muted-foreground">
              SYSTEM STATUS
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${isPaused === null ? "bg-zinc-500" : isPaused ? "bg-amber-500" : "bg-emerald-500"}`}
              />
              <span className="text-sm font-mono">
                {isPaused === null
                  ? "Loading..."
                  : isPaused
                    ? "PAUSED"
                    : "RUNNING"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Action cards */}
        <div className="space-y-4">
          <Card className="bg-zinc-900/60 border-zinc-700/40">
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="text-sm font-medium">Pause Trading</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Stop new trades. Existing positions stay tracked.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openDialog("pause")}
                disabled={isPaused === true}
              >
                <Pause className="size-3.5" />
                Pause
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/60 border-zinc-700/40">
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="text-sm font-medium">Resume Trading</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Resume market scanning and trade execution.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openDialog("resume")}
                disabled={isPaused === false}
              >
                <Play className="size-3.5" />
                Resume
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/60 border-red-900/30">
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="text-sm font-medium text-red-400">Wipe System</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Delete all data and reset portfolio. Cannot be undone.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => openDialog("wipe")}
              >
                <Trash2 className="size-3.5" />
                Wipe
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Password confirmation dialog */}
      <Dialog
        open={dialogAction !== null}
        onOpenChange={() => setDialogAction(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-mono tracking-wider text-sm">
              {config?.title}
            </DialogTitle>
          </DialogHeader>

          <p className="text-xs text-muted-foreground">{config?.description}</p>

          <div className="space-y-2">
            <label className="text-xs font-mono text-muted-foreground">
              Admin Password
            </label>
            <Input
              type="password"
              placeholder="Enter admin password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && execute()}
              autoFocus
            />
          </div>

          {error && <p className="text-xs text-red-400 font-mono">{error}</p>}
          {result && (
            <p className="text-xs text-emerald-400 font-mono">{result}</p>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDialogAction(null)}
            >
              Cancel
            </Button>
            <Button
              variant={config?.destructive ? "destructive" : "default"}
              size="sm"
              onClick={execute}
              disabled={!password || loading}
            >
              {loading ? "..." : config?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
