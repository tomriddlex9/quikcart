/** Same-origin proxy by default (httpOnly session cookie); a direct base when NEXT_PUBLIC_API_BASE is set. */
export function voiceApiRoot(): string {
  const direct = process.env.NEXT_PUBLIC_API_BASE;
  return direct ? `${direct.replace(/\/$/, "")}/api/v1` : "/qc-api/v1";
}

export function voiceFetchCredentials(): RequestCredentials {
  return process.env.NEXT_PUBLIC_API_BASE ? "include" : "same-origin";
}
