"use client";

// Session + preference context for the business console.
// Identity comes from GET /v1/auth/me (same-origin proxy). When the API or the
// session is unavailable the console runs as a demo persona with local preferences.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_DEMO_PERSONA,
  demoDisplayName,
  demoScopes,
  isBusinessPersonaName,
} from "@/lib/business/demo-business";
import type { BusinessPersona, BusinessScope } from "@/lib/business/types";

export const AUTH_BASE = "/qc-api/v1/auth";
const PREFS_KEY = "qc_business_prefs_v1";
const PERSONA_KEY = "qc_business_demo_persona_v1";
export const ONBOARDED_COOKIE = "qc_onb";

export interface BusinessPrefs {
  onboarded: boolean;
  store_ids: number[];
  pinned_metrics: string[];
  briefing_time: string;
  first_question: string | null;
  completed_journeys: string[];
  checklist_done: string[];
  checklist_dismissed: boolean;
  /** User opt-in for the talking assistant dock (server VOICE_ENABLED must also be on). */
  voice_enabled: boolean;
}

export const DEFAULT_BUSINESS_PREFS: BusinessPrefs = {
  onboarded: false,
  store_ids: [],
  pinned_metrics: [],
  briefing_time: "08:00",
  first_question: null,
  completed_journeys: [],
  checklist_done: [],
  checklist_dismissed: false,
  voice_enabled: false,
};

/** The four tiles shown on Today unless the user picks their own. */
export const DEFAULT_PINNED = ["sales_gmv", "orders", "average_basket", "on_time_rate"];

interface MeResponse {
  persona?: string;
  display_name?: string;
  scopes?: BusinessScope[];
  anonymous?: boolean;
  preferences?: {
    pinned_metrics?: string[];
    briefing_time?: string | null;
    completed_journeys?: string[];
    home_store_id?: number | null;
    onboarding_state?: Record<string, unknown>;
  } | null;
}

interface BusinessContextValue {
  ready: boolean;
  persona: BusinessPersona;
  displayName: string;
  scopes: BusinessScope[];
  /** True when a real session answered /auth/me. */
  signedIn: boolean;
  prefs: BusinessPrefs;
  pinned: string[];
  updatePrefs: (patch: Partial<BusinessPrefs>) => Promise<void>;
  setDemoPersona: (persona: BusinessPersona) => void;
}

const BusinessContext = createContext<BusinessContextValue | null>(null);

function readLocal<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (error) {
    console.warn("business: could not read local storage", key, error);
    return null;
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("business: could not write local storage", key, error);
  }
}

function setOnboardedCookie() {
  document.cookie = `${ONBOARDED_COOKIE}=1; path=/; max-age=31536000; samesite=lax`;
}

function serverPatch(patch: Partial<BusinessPrefs>, merged: BusinessPrefs): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.pinned_metrics) body.pinned_metrics = patch.pinned_metrics;
  if (patch.briefing_time) body.briefing_time = patch.briefing_time;
  if (patch.completed_journeys) body.completed_journeys = patch.completed_journeys;
  if (patch.store_ids && patch.store_ids.length > 0) body.home_store_id = patch.store_ids[0];
  if (
    patch.onboarded !== undefined ||
    patch.store_ids ||
    patch.first_question !== undefined ||
    patch.checklist_done ||
    patch.checklist_dismissed !== undefined
  ) {
    body.onboarding_state = {
      completed: merged.onboarded,
      store_ids: merged.store_ids,
      first_question: merged.first_question,
      checklist_done: merged.checklist_done,
      checklist_dismissed: merged.checklist_dismissed,
    };
  }
  return body;
}

export function BusinessProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [demoPersona, setDemoPersonaState] = useState<BusinessPersona>(DEFAULT_DEMO_PERSONA);
  const [prefs, setPrefs] = useState<BusinessPrefs>(DEFAULT_BUSINESS_PREFS);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    const controller = new AbortController();
    const stored = readLocal<Partial<BusinessPrefs>>(PREFS_KEY) ?? {};
    const storedPersona = readLocal<string>(PERSONA_KEY);
    if (isBusinessPersonaName(storedPersona)) setDemoPersonaState(storedPersona);
    let next: BusinessPrefs = { ...DEFAULT_BUSINESS_PREFS, ...stored };

    fetch(`${AUTH_BASE}/me`, { signal: controller.signal, cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<MeResponse>) : null))
      .then((body) => {
        if (body && !body.anonymous) {
          setMe(body);
          const server = body.preferences;
          if (server) {
            const state = server.onboarding_state ?? {};
            next = {
              ...next,
              pinned_metrics: server.pinned_metrics?.length ? server.pinned_metrics : next.pinned_metrics,
              briefing_time: server.briefing_time ? server.briefing_time.slice(0, 5) : next.briefing_time,
              completed_journeys: server.completed_journeys?.length
                ? server.completed_journeys
                : next.completed_journeys,
              store_ids: Array.isArray(state.store_ids)
                ? (state.store_ids as number[])
                : server.home_store_id
                  ? [server.home_store_id]
                  : next.store_ids,
              first_question:
                typeof state.first_question === "string" ? state.first_question : next.first_question,
              checklist_done: Array.isArray(state.checklist_done)
                ? (state.checklist_done as string[])
                : next.checklist_done,
              checklist_dismissed:
                typeof state.checklist_dismissed === "boolean"
                  ? state.checklist_dismissed
                  : next.checklist_dismissed,
              onboarded: state.completed === true || next.onboarded,
            };
          }
        }
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") {
          console.warn("business: /auth/me unavailable, running as a demo persona", error);
        }
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setPrefs(next);
        setReady(true);
      });
    return () => controller.abort();
  }, []);

  const updatePrefs = useCallback(
    async (patch: Partial<BusinessPrefs>) => {
      const merged = { ...prefsRef.current, ...patch };
      prefsRef.current = merged;
      setPrefs(merged);
      writeLocal(PREFS_KEY, merged);
      if (merged.onboarded) setOnboardedCookie();
      if (!me) return;
      const body = serverPatch(patch, merged);
      if (Object.keys(body).length === 0) return;
      try {
        const res = await fetch(`${AUTH_BASE}/me/preferences`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) console.warn("business: preferences not saved to the server", res.status);
      } catch (error) {
        console.warn("business: preferences saved locally only", error);
      }
    },
    [me],
  );

  const setDemoPersona = useCallback((next: BusinessPersona) => {
    setDemoPersonaState(next);
    writeLocal(PERSONA_KEY, next);
  }, []);

  const value = useMemo<BusinessContextValue>(() => {
    const sessionPersona = isBusinessPersonaName(me?.persona) ? me?.persona : null;
    const persona = sessionPersona ?? demoPersona;
    return {
      ready,
      persona,
      displayName: me?.display_name ?? demoDisplayName(persona),
      scopes: me?.scopes?.length ? me.scopes : demoScopes(persona),
      signedIn: me !== null,
      prefs,
      pinned: prefs.pinned_metrics.length > 0 ? prefs.pinned_metrics : DEFAULT_PINNED,
      updatePrefs,
      setDemoPersona,
    };
  }, [ready, me, demoPersona, prefs, updatePrefs, setDemoPersona]);

  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

const FALLBACK: BusinessContextValue = {
  ready: false,
  persona: DEFAULT_DEMO_PERSONA,
  displayName: demoDisplayName(DEFAULT_DEMO_PERSONA),
  scopes: demoScopes(DEFAULT_DEMO_PERSONA),
  signedIn: false,
  prefs: DEFAULT_BUSINESS_PREFS,
  pinned: DEFAULT_PINNED,
  updatePrefs: async () => {},
  setDemoPersona: () => {},
};

export function useBusiness(): BusinessContextValue {
  return useContext(BusinessContext) ?? FALLBACK;
}
