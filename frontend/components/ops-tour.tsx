"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  hasCompletedOpsTour,
  markOpsTourComplete,
  OPS_TOUR_REPLAY_EVENT,
  opsTourPlan,
  type OpsTourPlan,
} from "@/lib/ops-tour";
import { isOpsPersonaId } from "@/lib/personas";

type MeResponse = {
  persona?: string;
  anonymous?: boolean;
};

export function OpsTour() {
  const router = useRouter();
  const [plan, setPlan] = useState<OpsTourPlan | null>(null);
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);

  const tryOpen = useCallback((persona: string, force = false) => {
    const next = opsTourPlan(persona);
    if (!next) return;
    if (!force && hasCompletedOpsTour(persona)) return;
    setPlan(next);
    setStep(0);
    setOpen(true);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/qc-api/v1/auth/me", { signal: controller.signal, cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<MeResponse>) : null))
      .then((me) => {
        if (!me || me.anonymous || !isOpsPersonaId(me.persona)) return;
        tryOpen(me.persona!);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [tryOpen]);

  useEffect(() => {
    const onReplay = () => {
      fetch("/qc-api/v1/auth/me", { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<MeResponse>) : null))
        .then((me) => {
          if (!me || me.anonymous || !isOpsPersonaId(me.persona)) return;
          tryOpen(me.persona!, true);
        })
        .catch(() => undefined);
    };
    window.addEventListener(OPS_TOUR_REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(OPS_TOUR_REPLAY_EVENT, onReplay);
  }, [tryOpen]);

  function finish(goHref?: string) {
    if (plan) markOpsTourComplete(plan.persona);
    setOpen(false);
    if (goHref) router.push(goHref);
  }

  if (!plan) return null;
  const current = plan.steps[step];
  const last = step === plan.steps.length - 1;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) finish();
        else setOpen(true);
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription>{current.body}</DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Step {step + 1} of {plan.steps.length}
        </p>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={() => finish()}>
            Skip
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              Back
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => finish(current.href)}>
              {current.cta}
            </Button>
            {last ? (
              <Button type="button" size="sm" onClick={() => finish()}>
                Done
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => setStep((s) => s + 1)}>
                Next
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
