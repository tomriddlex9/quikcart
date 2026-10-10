"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BriefingTimePicker } from "@/components/business/briefing-time-picker";
import { GoalPicker, GOALS, metricsForGoals } from "@/components/business/goal-picker";
import { OnboardingStepper } from "@/components/business/onboarding-stepper";
import { QuickQuestionChips } from "@/components/business/quick-question-chips";
import { scopeLabel } from "@/components/business/scope-chip";
import { StorePicker } from "@/components/business/store-picker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_PINNED, useBusiness } from "@/lib/business/business-context";
import { DEMO_PERSONAS } from "@/lib/business/demo-business";
import { firstName } from "@/lib/business/format";
import type { StoreScorecardsResponse } from "@/lib/business/types";
import { useBusinessData } from "@/lib/business/use-business-api";

const STEPS = ["You", "Your stores", "What matters", "Ask & briefing"] as const;

const QUESTIONS_BY_PERSONA: Record<string, string[]> = {
  business_exec: [
    "How are sales today compared with last week?",
    "Which cities need help right now?",
    "Where is money slipping away?",
  ],
  city_manager: [
    "How is Bengaluru doing vs last week?",
    "Which stores need help right now?",
    "Are deliveries on time across the city?",
  ],
  store_manager: [
    "How is my store doing today?",
    "What is about to run out?",
    "Are my deliveries on time?",
  ],
  category_manager: [
    "How is Dairy selling today?",
    "Which Dairy lines are about to run out?",
    "Is the average basket healthy?",
  ],
  leadership: [
    "Are we on pace for the month?",
    "Which stores need escalation?",
    "Is the money healthy?",
  ],
};

const DEFAULT_GOALS_BY_PERSONA: Record<string, string[]> = {
  business_exec: ["sales", "delivery"],
  city_manager: ["delivery", "sales"],
  store_manager: ["stock", "delivery"],
  category_manager: ["stock", "sales"],
  leadership: ["sales", "customers"],
};

const heading = "text-2xl font-semibold tracking-tight";

export default function WelcomePage() {
  const router = useRouter();
  const { ready, persona, displayName, scopes, prefs, updatePrefs } = useBusiness();
  const stores = useBusinessData<StoreScorecardsResponse>("/stores/scorecards");

  const [step, setStep] = useState(0);
  const [storeIds, setStoreIds] = useState<number[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [question, setQuestion] = useState<string | null>(null);
  const [briefing, setBriefing] = useState("08:00");
  const [saving, setSaving] = useState(false);

  const questions = QUESTIONS_BY_PERSONA[persona] ?? QUESTIONS_BY_PERSONA.business_exec;
  const skipStores = persona === "store_manager";

  useEffect(() => {
    if (!ready) return;
    setStoreIds(prefs.store_ids);
    setQuestion(prefs.first_question);
    setBriefing(prefs.briefing_time);
    if (prefs.pinned_metrics.length > 0) {
      const inferred = GOALS.filter((g) =>
        g.metrics.some((m) => prefs.pinned_metrics.includes(m)),
      ).map((g) => g.id);
      setGoals(inferred.length > 0 ? inferred : DEFAULT_GOALS_BY_PERSONA[persona] ?? ["sales"]);
    } else {
      setGoals(DEFAULT_GOALS_BY_PERSONA[persona] ?? ["sales"]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, persona]);

  // Auto-skip the stores step for store managers.
  useEffect(() => {
    if (step === 1 && skipStores) setStep(2);
  }, [step, skipStores]);

  const roleLabel = useMemo(
    () => DEMO_PERSONAS.find((p) => p.persona === persona)?.label ?? "Business user",
    [persona],
  );
  const numbers = useMemo(
    () =>
      goals.length > 0
        ? metricsForGoals(goals)
        : prefs.pinned_metrics.length > 0
          ? prefs.pinned_metrics
          : DEFAULT_PINNED,
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

  async function skip() {
    setSaving(true);
    await updatePrefs({ onboarded: true });
    router.push("/b/today");
  }

  function goNext() {
    if (step === 0 && skipStores) {
      setStep(2);
      return;
    }
    setStep((s) => s + 1);
  }

  function goBack() {
    if (step === 2 && skipStores) {
      setStep(0);
      return;
    }
    setStep((s) => Math.max(0, s - 1));
  }

  return (
    <div className="space-y-8">
      <OnboardingStepper steps={STEPS} current={step} />

      <section aria-live="polite" className="min-h-64 space-y-4">
        {step === 0 ? (
          <>
            <h1 className={heading}>Welcome, {firstName(displayName)}.</h1>
            <p className="text-[15px] text-foreground/90">
              We&apos;ve set QuickCart up for your role. Confirm this looks right, then we&apos;ll
              personalise Today.
            </p>
            <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
              <p className="font-medium">{displayName}</p>
              <p className="mt-1 text-muted-foreground">
                {roleLabel} · {scopeLabel(scopes)}
              </p>
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <h1 className={heading}>Which stores do you care about most?</h1>
            <p className="text-sm text-muted-foreground">
              Pick any you want to keep close. Skip this to keep all{" "}
              {stores.data?.stores.length ?? ""} in view.
            </p>
            {stores.loading && !stores.data ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-3/4" />
              </div>
            ) : (
              <StorePicker
                stores={stores.data?.stores ?? []}
                value={storeIds}
                onChange={setStoreIds}
              />
            )}
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h1 className={heading}>What matters most to you right now?</h1>
            <p className="text-sm text-muted-foreground">
              We&apos;ll put the matching numbers at the top of Today. You can change them any time
              in Settings.
            </p>
            <GoalPicker value={goals} onChange={setGoals} />
          </>
        ) : null}

        {last ? (
          <>
            <h1 className={heading}>Ask anything — then set your briefing.</h1>
            <p className="text-[15px] text-foreground/90">
              The Ask center answers in plain English and can suggest actions, but never changes
              anything on its own. A named person approves every action.
            </p>
            <ul className="space-y-1.5">
              {questions.map((q) => (
                <li key={q}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring">
                    <input
                      type="radio"
                      name="first-question"
                      checked={question === q}
                      onChange={() => setQuestion(q)}
                    />
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
              value={question && !questions.includes(question) ? question : ""}
              onChange={(e) => setQuestion(e.target.value || null)}
              className="h-9 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              placeholder="Ask anything about your stores"
            />
            <div className="pt-2">
              <h2 className="text-sm font-medium">Morning briefing</h2>
              <p className="mb-2 text-xs text-muted-foreground">
                When should Today be ready for you?
              </p>
              <BriefingTimePicker value={briefing} onChange={setBriefing} />
            </div>
            <ul className="space-y-1 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground/90">
              <li>
                Stores:{" "}
                {storeIds.length > 0 ? `${storeIds.length} favourites` : "everything you can see"}
              </li>
              <li>Today shows {numbers.length} numbers of your choice</li>
              <li>First question: {question ?? "none yet"}</li>
              <li>Briefing at {briefing}</li>
            </ul>
            {question ? null : <QuickQuestionChips questions={questions} />}
          </>
        ) : null}
      </section>

      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" disabled={step === 0 || saving} onClick={goBack}>
            Back
          </Button>
          <Button variant="ghost" size="sm" disabled={saving} onClick={() => void skip()}>
            Skip for now
          </Button>
        </div>
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
          <Button onClick={goNext}>{step === 0 ? "Looks right" : "Next"}</Button>
        )}
      </div>
    </div>
  );
}
