/** Client-side intent preview for the query generator.

Mirrors ``quickcart.api.sql_intent`` closely enough to warn before the network
round-trip. The API remains the enforcement boundary.
*/

export type SqlQuestionIntent =
  | "read"
  | "mutate"
  | "schema_change"
  | "admin"
  | "exfiltrate"
  | "off_topic";

export type IntentPreview = {
  intent: SqlQuestionIntent;
  allowed: boolean;
  reason: string;
  joke: string | null;
};

const MUTATE =
  /\b(delete|remove|wipe|erase|purge|destroy|drop\s+all|clear\s+out)\b/i;
const MUTATE_UPDATE =
  /\b(update|modify|overwrite|mutate|edit|change)\b[\s\S]{0,40}\b(row|rows|order|orders|table|tables|record|records|data|inventory|payment|customer)\b/i;
const MUTATE_INSERT =
  /\b(insert|add\s+a\s+row|create\s+an?\s+order|write\s+into|upsert|merge\s+into)\b/i;
const SCHEMA =
  /\b(drop\s+(table|database|schema|view|index|column)|alter\s+table|create\s+(table|index|view|schema|database)|add\s+column|rename\s+(table|column))\b/i;
const ADMIN =
  /\b(grant|revoke|vacuum|reindex|cluster|analyze|refresh\s+materialized|pg_sleep|kill\s+connections?|shutdown)\b/i;
const EXFIL =
  /\b(dump\s+(the\s+)?(database|db|all\s+tables)|export\s+everything|passwords?|credentials?|secrets?|pg_read_file)\b/i;
const OFF =
  /\b(ignore\s+(previous|all)\s+instructions|jailbreak|system\s+prompt|write\s+(me\s+)?a\s+poem|tell\s+me\s+a\s+joke|what'?s\s+the\s+weather)\b/i;
const READ =
  /\b(select|show|list|how\s+many|count|top|rank|average|avg|sum|total|trend|compare|which|what|when|where|find|fetch|get|report|metric|gmv|late|cancel|forecast)\b/i;

const JOKES: Record<Exclude<SqlQuestionIntent, "read">, string[]> = {
  mutate: [
    "I'd rewrite your rows, but my union card only covers SELECT.",
    "DELETE is how databases get separation anxiety. Read-only therapy only.",
    "I left my WRITE permissions in my other jacket.",
  ],
  schema_change: [
    "DROP TABLE is a lifestyle choice I don't support.",
    "I don't do interior design for schemas — only window shopping via SELECT.",
  ],
  admin: [
    "Admin spells stay in the runbook. Read-only is the house style.",
    "VACUUM in public? Absolutely not.",
  ],
  exfiltrate: [
    "I don't do data heists. Ask for a narrow SELECT instead.",
    "Full dumps are off the menu. Today's special is analytics.",
  ],
  off_topic: [
    "Cute, but this is a warehouse, not a comedy club. Ask about GMV.",
    "I'll save the jokes for when you try to DROP something.",
  ],
};

function pickJoke(intent: Exclude<SqlQuestionIntent, "read">, question: string): string {
  const options = JOKES[intent];
  let hash = 0;
  const key = `${intent}:${question.trim().toLowerCase()}`;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return options[hash % options.length];
}

export function classifyQuestionIntent(question: string): IntentPreview {
  const text = question.trim().replace(/\s+/g, " ");
  if (!text) {
    return {
      intent: "off_topic",
      allowed: false,
      reason: "Empty question — ask for a read-only metric or listing.",
      joke: pickJoke("off_topic", "empty"),
    };
  }

  if (SCHEMA.test(text)) {
    return {
      intent: "schema_change",
      allowed: false,
      reason: "That sounds like a schema change (DDL). This console is read-only.",
      joke: pickJoke("schema_change", text),
    };
  }
  if (ADMIN.test(text)) {
    return {
      intent: "admin",
      allowed: false,
      reason: "That sounds like database administration. Not available here.",
      joke: pickJoke("admin", text),
    };
  }
  if (EXFIL.test(text)) {
    return {
      intent: "exfiltrate",
      allowed: false,
      reason: "That sounds like a bulk dump or secret grab. Refused.",
      joke: pickJoke("exfiltrate", text),
    };
  }
  if (MUTATE.test(text) || MUTATE_UPDATE.test(text) || MUTATE_INSERT.test(text) || /\btruncate\b/i.test(text)) {
    return {
      intent: "mutate",
      allowed: false,
      reason: "That sounds like a write or delete. Only SELECT / WITH queries are allowed.",
      joke: pickJoke("mutate", text),
    };
  }
  if (OFF.test(text) && !READ.test(text)) {
    return {
      intent: "off_topic",
      allowed: false,
      reason: "That doesn't look like an analytics question about QuickCart data.",
      joke: pickJoke("off_topic", text),
    };
  }

  return {
    intent: "read",
    allowed: true,
    reason: "Looks like a read / analytics question.",
    joke: null,
  };
}

/** Funny one-liners when typed SQL itself looks like a write. */
export const SQL_WRITE_JOKES = [
  "Nice try — this console only speaks SELECT. Mutating SQL stays on the cutting-room floor.",
  "That keyword belongs in a disaster movie, not this workbench.",
  "I would run that, but then I'd have to update the incident report template.",
] as const;

export function sqlWriteJoke(sql: string): string {
  let hash = 0;
  for (let i = 0; i < sql.length; i += 1) hash = (hash * 31 + sql.charCodeAt(i)) >>> 0;
  return SQL_WRITE_JOKES[hash % SQL_WRITE_JOKES.length];
}
