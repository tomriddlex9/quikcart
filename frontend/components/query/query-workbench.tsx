"use client";

import { useMemo, useState } from "react";
import { Play, Sparkles, TriangleAlert, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { postJsonWithTimeout } from "@/components/query/query-client";
import { ResultsTable } from "@/components/query/results-table";
import { TemplatePicker } from "@/components/query/template-picker";
import { classifyQuestionIntent, sqlWriteJoke } from "@/lib/sql-intent";
import { SQL_TEMPLATES, type SqlTemplate } from "@/lib/sql-templates";
import type { SqlExecuteResponse, SqlGenerateResponse, SqlSource } from "@/lib/types";

// SQL generation calls Gemini via the API — 45s covers network + generation without
// leaving the UI hung if the key is missing or the upstream is slow.
const GENERATE_TIMEOUT_MS = 45_000;
// Analytical queries (window functions, multi-way joins) run longer than a typical
// CRUD write, but should still fail fast if the API or engine is unreachable.
const EXECUTE_TIMEOUT_MS = 30_000;
const ROW_LIMIT = 200;

const SOURCE_LABEL: Record<SqlSource, string> = {
  postgres: "PostgreSQL — the live operational database",
  lakehouse: "Lakehouse — Silver / Gold Delta tables",
};

const WRITE_KEYWORDS =
  /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|call|copy|merge|vacuum|reindex|refresh)\b/i;

function stripSqlComments(sql: string): string {
  return sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Client-side courtesy only — a nudge toward read-only SQL, not the enforcement
 * boundary. The API must reject writes server-side regardless of what this page allows.
 */
function writeGuardMessage(sql: string): string | null {
  const body = stripSqlComments(sql).trim();
  if (body.length === 0) return null;
  if (!/^(with|select)\b/i.test(body)) {
    return "This doesn't start with SELECT or WITH — the API only executes read-only queries.";
  }
  const match = body.match(WRITE_KEYWORDS);
  if (match) {
    return `Contains "${match[0].toUpperCase()}" — the API only executes read-only queries.`;
  }
  return null;
}

export function QueryWorkbench() {
  const [source, setSource] = useState<SqlSource>("postgres");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [sql, setSql] = useState("");
  const [question, setQuestion] = useState("");

  const [generating, setGenerating] = useState(false);
  const [generateInfo, setGenerateInfo] = useState<SqlGenerateResponse | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [intentBlock, setIntentBlock] = useState<{
    reason: string;
    joke: string | null;
    intent: string;
  } | null>(null);

  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<SqlExecuteResponse | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const templates = useMemo(() => SQL_TEMPLATES.filter((t) => t.source === source), [source]);
  const guardMessage = useMemo(() => writeGuardMessage(sql), [sql]);
  const guardJoke = useMemo(() => (guardMessage ? sqlWriteJoke(sql) : null), [guardMessage, sql]);
  const liveIntent = useMemo(() => classifyQuestionIntent(question), [question]);
  const questionBlocked = question.trim().length > 0 && !liveIntent.allowed;

  const changeSource = (next: SqlSource) => {
    if (next === source) return;
    setSource(next);
    setSelectedTemplateId(null);
    setRunResult(null);
    setRunError(null);
  };

  const selectTemplate = (template: SqlTemplate) => {
    setSelectedTemplateId(template.id);
    setSql(template.sql);
    setRunResult(null);
    setRunError(null);
    setGenerateInfo(null);
    setGenerateError(null);
    setIntentBlock(null);
  };

  const generate = async () => {
    const trimmed = question.trim();
    if (!trimmed || generating) return;

    const preview = classifyQuestionIntent(trimmed);
    if (!preview.allowed) {
      setIntentBlock({
        reason: preview.reason,
        joke: preview.joke,
        intent: preview.intent,
      });
      setGenerateInfo(null);
      setGenerateError(null);
      setSql("");
      return;
    }

    setGenerating(true);
    setGenerateError(null);
    setGenerateInfo(null);
    setIntentBlock(null);
    const result = await postJsonWithTimeout<SqlGenerateResponse>(
      "/api/v1/sql/generate",
      { question: trimmed, source },
      GENERATE_TIMEOUT_MS,
    );
    setGenerating(false);
    if (!result.ok) {
      setGenerateError(
        result.status === 0
          ? "The API isn't reachable at all — check that it's running."
          : `Generation failed: ${result.detail}`,
      );
      return;
    }

    if (result.data.allowed === false) {
      setIntentBlock({
        reason: result.data.notes[0] ?? "That question was blocked by intent guardrails.",
        joke:
          result.data.joke ??
          result.data.notes.find((note) => note !== result.data.notes[0]) ??
          null,
        intent: result.data.intent ?? "mutate",
      });
      setGenerateInfo(result.data);
      setSql("");
      return;
    }

    setSelectedTemplateId(null);
    setGenerateInfo(result.data);
    if (result.data.sql) {
      setSql(result.data.sql);
    } else {
      setGenerateError(
        "The model returned no usable SQL for this question. Try rephrasing it, or pick a template below — that path never depends on the model.",
      );
    }
  };

  const run = async () => {
    const trimmed = sql.trim();
    if (!trimmed || running || guardMessage) return;
    setRunning(true);
    setRunError(null);
    const result = await postJsonWithTimeout<SqlExecuteResponse>(
      "/api/v1/sql/execute",
      { source, sql: trimmed, limit: ROW_LIMIT },
      EXECUTE_TIMEOUT_MS,
    );
    setRunning(false);
    if (!result.ok) {
      setRunResult(null);
      setRunError(
        result.status === 0
          ? "The API isn't reachable at all — check that it's running."
          : result.detail,
      );
      return;
    }
    setRunResult(result.data);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>1. Pick a source and a question</CardTitle>
          <CardDescription>
            Templates are plain SQL text and always work, even with the API&apos;s model offline.
            Natural language is intent-classified first — writes, DDL, and admin asks are refused
            (sometimes with a joke) before any model call.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Tabs
              value={source}
              onValueChange={(value) => {
                if (value === "postgres" || value === "lakehouse") changeSource(value);
              }}
            >
              <TabsList variant="line" aria-label="SQL source">
                <TabsTrigger value="postgres">PostgreSQL</TabsTrigger>
                <TabsTrigger value="lakehouse">Lakehouse</TabsTrigger>
              </TabsList>
            </Tabs>
            <p className="text-xs text-muted-foreground">
              {SOURCE_LABEL[source]} · {templates.length} templates
            </p>
          </div>

          <TemplatePicker templates={templates} selectedId={selectedTemplateId} onSelect={selectTemplate} />

          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <label htmlFor="query-question" className="text-xs font-medium text-muted-foreground">
                Or ask in plain English
              </label>
              <Textarea
                id="query-question"
                value={question}
                onChange={(e) => {
                  setQuestion(e.target.value);
                  setIntentBlock(null);
                }}
                placeholder="e.g. Which stores have the highest late-delivery rate this week?"
                rows={2}
                aria-invalid={questionBlocked || undefined}
              />
              {questionBlocked ? (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  Intent preview: <span className="font-medium">{liveIntent.intent}</span> — generation
                  will be blocked.
                </p>
              ) : null}
            </div>
            <Button
              onClick={() => void generate()}
              disabled={generating || question.trim().length === 0 || questionBlocked}
            >
              <Wand2 data-icon="inline-start" />
              {generating ? "Generating…" : "Generate SQL"}
            </Button>
          </div>

          {intentBlock ? (
            <div
              role="alert"
              className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm text-amber-950 dark:text-amber-100"
            >
              <p className="flex items-start gap-2 font-medium">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                Guardrail · intent <span className="font-mono">{intentBlock.intent}</span>
              </p>
              <p className="text-xs leading-relaxed opacity-90">{intentBlock.reason}</p>
              {intentBlock.joke ? (
                <p className="border-t border-amber-500/30 pt-2 text-xs italic leading-relaxed opacity-90">
                  {intentBlock.joke}
                </p>
              ) : null}
            </div>
          ) : null}

          {generateError ? (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {generateError}
            </p>
          ) : null}
          {generateInfo && generateInfo.allowed !== false ? (
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  <Sparkles data-icon="inline-start" />
                  {generateInfo.model ?? "no model configured"}
                </Badge>
                {generateInfo.intent ? (
                  <Badge variant="outline">intent · {generateInfo.intent}</Badge>
                ) : null}
                {generateInfo.degraded ? (
                  <Badge variant="destructive">Model unavailable — heuristic fallback</Badge>
                ) : !generateInfo.valid ? (
                  <Badge variant="outline">rejected by the read-only guard — review before running</Badge>
                ) : (
                  <Badge variant="outline">passed the read-only guard</Badge>
                )}
              </div>
              {generateInfo.notes.length > 0 ? (
                <ul className="list-inside list-disc space-y-0.5">
                  {generateInfo.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>2. Review the SQL</CardTitle>
          <CardDescription>
            Always editable, never auto-run. Only SELECT / WITH statements are executed — the API
            enforces that server-side no matter what this page lets you type.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            placeholder="Pick a template or generate SQL above, or write your own SELECT statement here."
            className="min-h-48 font-mono text-xs"
            spellCheck={false}
          />
          {guardMessage ? (
            <div
              role="alert"
              className="space-y-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              <p className="flex items-start gap-2 font-medium">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                {guardMessage}
              </p>
              {guardJoke ? <p className="italic opacity-90">{guardJoke}</p> : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void run()} disabled={running || sql.trim().length === 0 || !!guardMessage}>
              <Play data-icon="inline-start" />
              {running ? "Running…" : `Run against ${source}`}
            </Button>
            <span className="text-xs text-muted-foreground">Results capped at {ROW_LIMIT} rows.</span>
          </div>
          {runError ? (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {runError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>3. Results</CardTitle>
          <CardDescription>Read-only rows straight from the API — nothing here is demo data.</CardDescription>
        </CardHeader>
        <CardContent>
          {runResult ? (
            <ResultsTable result={runResult} />
          ) : (
            <div className="grid h-32 place-items-center text-sm text-muted-foreground">
              Run a query above to see results here.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
