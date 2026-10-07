"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BriefingTimePicker } from "@/components/business/briefing-time-picker";
import { GoalPicker, metricsForGoals } from "@/components/business/goal-picker";
import { OnboardingStepper } from "@/components/business/onboarding-stepper";
import { QuickQuestionChips } from "@/components/business/quick-question-chips";
import { RoleCardGroup } from "@/components/business/role-card-group";
import { scopeLabel } from "@/components/business/scope-chip";
import { StorePicker } from "@/components/business/store-picker";
import { Button } from "@/components/ui/button";
import { DEFAULT_PINNED, useBusiness } from "@/lib/business/business-context";
import { DEMO_PERSONAS } from "@/lib/business/demo-business";
import { firstName } from "@/lib/business/format";
import type { BusinessPersona, StoreScorecardsResponse } from "@/lib/business/types";
import { useBusinessData } from "@/lib/business/use-business-api";

const STEPS = ["Your role", "Your stores", "What matters", "Your assistant", "First question", "Briefing", "All set"] as const;
const QUESTIONS = [
  "How are sales today compared with last week?",
  "Which stores need help right now?",
  "What is about to run out?",
];

const ROLE_OPTIONS = DEMO_PERSONAS.map((p) => ({ value: p.persona, label: p.label }));

const heading = "text-2xl font-semibold tracking-tight";

export default function WelcomePage() {
  const router = useRouter();
  const { ready, persona, displayName, scopes, signedIn, prefs, updatePrefs, setDemoPersona } = useBusiness();
  const stores = useBusinessData<StoreScorecardsResponse>("/stores/scorecards");

  const [step, setStep] = useState(0);
  const [storeIds, setStoreIds] = useState<number[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [question, setQuestion] = useState<string | null>(null);
  const [briefing, setBriefing] = useState("08:00");
  const [saving, setSaving] = useState(false);

  // Start from anything saved earlier (returning from a half-finished tour).
  useEffect(() => {
    if (!ready) return;
    setStoreIds(prefs.store_ids);
    setQuestion(prefs.first_question);
    setBriefing(prefs.briefing_time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const roleLabel = useMemo(() => DEMO_PERSONAS.find((p) => p.persona === persona)?.label ?? "Business user", [persona]);
  const numbers = useMemo(
    () => (goals.length > 0 ? metricsForGoals(goals) : prefs.pinned_metrics.length > 0 ? prefs.pinned_metrics : DEFAULT_PINNED),
    [goals, prefs.pinned_metrics],
  );
  const last = step === STEPS.length - 1;

  async function finish(goAsk: boolean) {
    setSaving(true);
    await updatePrefs({
      onboarded: true,
      store_ids: storeIds,
      pinned_metrics: numbers,
      first_question: question,
      briefing_time: briefing,
    });
    router.push(goAsk && question ? `/b/ask?q=${encodeURIComponent(question)}` : "/b/today");
  }

  return (
    <div className="space-y-8">
      <OnboardingStepper steps={STEPS} current={step} />

      <section aria-live="polite" className="min-h-64 space-y-4">
        {step === 0 ? (
          <>
            <h1 className={heading}>Welcome, {firstName(displayName)}.</h1>
            <p className="text-[15px] text-foreground/90">
              We've set QuickCart up for a <strong>{roleLabel.toLowerCase()}</strong> who can see{" "}
              <strong>{scopeLabel(scopes).toLowerCase()}</strong>. Is that right?
            </p>
            <RoleCardGroup
              roles={ROLE_OPTIONS}
              value={persona}
              locked={signedIn}
              onChange={(next) => setDemoPersona(next as BusinessPersona)}
            />
            <p className="text-sm text-muted-foreground">
              {signedIn
                ? "Your access is set by your role and can't be changed here. Tell your admin if it looks wrong."
                : "You're not signed in, so you can try any role on sample data."}
            </p>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <h1 className={heading}>Which stores do you care about most?</h1>
            <p className="text-sm text-muted-foreground">
              Pick any you want to keep close. Skip this to keep all {stores.data?.stores.length ?? ""} in view.
            </p>
            <StorePicker stores={stores.data?.stores ?? []} value={storeIds} onChange={setStoreIds} />
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h1 className={heading}>What matters most to you right now?</h1>
            <p className="text-sm text-muted-foreground">
              We'll put the matching numbers at the top of Today. You can change them any time in Settings.
            </p>
            <GoalPicker value={goals} onChange={setGoals} />
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h1 className={heading}>Meet your assistant.</h1>
            <p className="text-[15px] text-foreground/90">
              The Ask center answers questions in plain English: why sales dipped, which store is struggling,
              what will run out. It can suggest actions, but it never changes anything on its own. A named
              person approves every action.
            </p>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <h1 className={heading}>What would you like to ask first?</h1>
            <ul className="space-y-1.5">
              {QUESTIONS.map((q) => (
                <li key={q}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
                    <input type="radio" name="first-question" checked={question === q} onChange={() => setQuestion(q)} />
                    {q}
                  </label>
                </li>
              ))}
            </ul>
            <label htmlFor="own-question" className="block text-xs text-muted-foreground">
              Or write your own
            </label>
            <input
              id="own-question"
              value={question && !QUESTIONS.includes(question) ? question : ""}
              onChange={(e) => setQuestion(e.target.value || null)}
              className="h-9 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              placeholder="Ask anything about your stores"
            />
          </>
        ) : null}

        {step === 5 ? (
          <>
            <h1 className={heading}>When should your morning briefing be ready?</h1>
            <BriefingTimePicker value={briefing} onChange={setBriefing} />
          </>
        ) : null}

        {last ? (
          <>
            <h1 className={heading}>You're all set.</h1>
            <ul className="space-y-1 text-[15px] text-foreground/90">
              <li>Stores: {storeIds.length > 0 ? `${storeIds.length} favourites` : "everything you can see"}</li>
              <li>Today shows {numbers.length} numbers of your choice</li>
              <li>First question: {question ?? "none yet"}</li>
              <li>Briefing at {briefing}</li>
            </ul>
            {question ? null : <QuickQuestionChips questions={QUESTIONS} />}
          </>
        ) : null}
      </section>

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" disabled={step === 0 || saving} onClick={() => setStep((s) => s - 1)}>
          Back
        </Button>
        {last ? (
          <div className="flex gap-2">
            {question ? (
              <Button variant="outline" disabled={saving} onClick={() => void finish(true)}>
                Finish and ask
              </Button>
            ) : null}
            <Button disabled={saving} onClick={() => void finish(false)}>
              Go to Today
            </Button>
          </div>
        ) : (
          <Button onClick={() => setStep((s) => s + 1)}>{step === 0 ? "Yes, that's right" : "Next"}</Button>
        )}
      </div>
    </div>
  );
}
