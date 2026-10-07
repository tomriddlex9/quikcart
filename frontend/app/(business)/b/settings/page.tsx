"use client";

import { useBusiness, DEFAULT_PINNED } from "@/lib/business/business-context";
import { BusinessPage } from "@/components/business/business-page";
import { useMarkChecklist } from "@/components/business/getting-started-checklist";
import { scopeLabel } from "@/components/business/scope-chip";
import { RareUiCredit } from "@/components/assistant/rare-ui-credit";
import { Button } from "@/components/ui/button";
import { DEMO_PERSONAS } from "@/lib/business/demo-business";
import type { BusinessPersona, MetricsCatalogResponse } from "@/lib/business/types";
import { useBusinessData } from "@/lib/business/use-business-api";

const MAX_PINNED = 4;

export default function SettingsPage() {
  const { persona, displayName, scopes, signedIn, prefs, pinned, updatePrefs, setDemoPersona } = useBusiness();
  const mark = useMarkChecklist();
  const metrics = useBusinessData<MetricsCatalogResponse>("/metrics");
  const togglePinned = (key: string) => {
    const next = pinned.includes(key) ? pinned.filter((k) => k !== key) : [...pinned, key].slice(-MAX_PINNED);
    void updatePrefs({ pinned_metrics: next });
  };

  return (
    <BusinessPage title="Settings" description="Make the console yours.">
      <div className="space-y-6">
        <section className="space-y-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="text-sm font-medium">You</h2>
          <p className="text-sm">{displayName}</p>
          <p className="text-[13px] text-muted-foreground">You can see: {scopeLabel(scopes)}</p>
          {signedIn ? null : (
            <div className="pt-1">
              <label htmlFor="persona" className="text-xs text-muted-foreground">
                Sample role (you are not signed in, so this changes the sample data)
              </label>
              <select
                id="persona"
                value={persona}
                onChange={(e) => setDemoPersona(e.target.value as BusinessPersona)}
                className="mt-1 block h-8 w-full max-w-xs rounded-lg border border-input bg-background px-2 text-sm"
              >
                {DEMO_PERSONAS.map((p) => (
                  <option key={p.persona} value={p.persona}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>

        <section className="space-y-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="text-sm font-medium">Numbers on your Today page</h2>
          <p className="text-[13px] text-muted-foreground">
            Pick up to {MAX_PINNED}. {pinned.length} chosen.
          </p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {(metrics.data?.metrics ?? []).map((m) => {
              const checked = pinned.includes(m.key);
              return (
                <li key={m.key}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-secondary/60">
                    <input type="checkbox" checked={checked} onChange={() => togglePinned(m.key)} />
                    {m.label}
                  </label>
                </li>
              );
            })}
          </ul>
          <Button variant="ghost" size="xs" onClick={() => void updatePrefs({ pinned_metrics: DEFAULT_PINNED })}>
            Reset to the usual four
          </Button>
        </section>

        <section className="space-y-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="text-sm font-medium">Morning briefing</h2>
          <label htmlFor="briefing" className="text-[13px] text-muted-foreground">
            When would you like it?
          </label>
          <input
            id="briefing"
            type="time"
            value={prefs.briefing_time}
            onChange={(e) => {
              void updatePrefs({ briefing_time: e.target.value });
              mark("set_briefing");
            }}
            className="block h-8 rounded-lg border border-input bg-background px-2 text-sm"
          />
        </section>

        <section className="space-y-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="text-sm font-medium">Voice assistant</h2>
          <p className="text-[13px] text-muted-foreground">
            Talking to the assistant needs a Gemini API key on the server and{" "}
            <code className="text-xs">VOICE_ENABLED=true</code>. Your preference only
            controls whether the floating character is shown in this browser.
          </p>
          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={prefs.voice_enabled}
              onChange={(e) => {
                void updatePrefs({ voice_enabled: e.target.checked });
              }}
            />
            Show the voice character in the corner
          </label>
        </section>

        <section className="space-y-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="text-sm font-medium">Getting started</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void updatePrefs({ checklist_dismissed: false, checklist_done: [] })}
          >
            Show the getting-started list again
          </Button>
        </section>

        <section className="space-y-1 rounded-xl border border-dashed border-border p-4">
          <h2 className="text-sm font-medium">About</h2>
          <p className="text-[13px] text-muted-foreground">
            Interface inspiration from Rare UI. The voice assistant&apos;s dot-matrix orb is an original
            component modelled on Rare UI&apos;s Matrix Orb.
          </p>
          <RareUiCredit />
        </section>
      </div>
    </BusinessPage>
  );
}
