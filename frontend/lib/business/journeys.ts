// Journey helpers: link normalisation and resume-position storage.

const PROGRESS_KEY = "qc_journey_progress_v1";

const LINK_REWRITES: [RegExp, string][] = [
  [/^\/business\/metrics\/.*$/, "/b/learn"],
  [/^\/business\/alerts(\?.*)?$/, "/b/actions"],
  [/^\/business\/(.*)$/, "/b/$1"],
];

/** The API still returns /business/* links; the console lives under /b/*. */
export function normalizeJourneyLink(link: string | null | undefined): string | null {
  if (!link) return null;
  for (const [pattern, replacement] of LINK_REWRITES) {
    if (pattern.test(link)) return link.replace(pattern, replacement);
  }
  return link;
}

/** Which page section a tour step points at (matches `<Spotlight journeyId>` on that page). */
const SPOT_BY_PATH: Record<string, string> = {
  "/b/today": "attention",
  "/b/stores": "stores",
  "/b/products": "products",
};

/** Adds `?spot=` so the destination page can highlight the section the step talks about. */
export function withSpotlight(link: string): string {
  const [path, query = ""] = link.split("?");
  const spot = SPOT_BY_PATH[path];
  if (!spot) return link;
  const params = new URLSearchParams(query);
  params.set("spot", spot);
  return `${path}?${params.toString()}`;
}

export function readJourneyProgress(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch (error) {
    console.warn("business: could not read journey progress", error);
    return {};
  }
}

export function saveJourneyProgress(id: string, step: number | null): void {
  try {
    const next = readJourneyProgress();
    if (step === null) delete next[id];
    else next[id] = step;
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn("business: could not save journey progress", error);
  }
}
