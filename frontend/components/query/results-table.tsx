"use client";

import { useState } from "react";
import { Check, Clock3, Copy, Rows3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SqlExecuteResponse } from "@/lib/types";

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function resultToCsv(result: SqlExecuteResponse): string {
  const header = result.columns.map(csvCell).join(",");
  const body = result.rows
    .map((row) => result.columns.map((column) => csvCell(row[column])).join(","))
    .join("\n");
  return body.length > 0 ? `${header}\n${body}` : header;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function ResultsTable({ result }: { result: SqlExecuteResponse }) {
  const [copied, setCopied] = useState(false);

  const copyCsv = () => {
    void navigator.clipboard
      .writeText(resultToCsv(result))
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => setCopied(false));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">
          <Rows3 data-icon="inline-start" />
          {result.row_count.toLocaleString()} row{result.row_count === 1 ? "" : "s"}
        </Badge>
        <Badge variant="outline">
          <Clock3 data-icon="inline-start" />
          {result.elapsed_ms.toLocaleString()} ms
        </Badge>
        <Badge variant="outline">{result.source}</Badge>
        {result.truncated ? (
          <Badge variant="destructive">truncated — increase the limit to see more rows</Badge>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={copyCsv}
          disabled={result.rows.length === 0}
        >
          {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {copied ? "Copied" : "Copy CSV"}
        </Button>
      </div>

      {result.rows.length === 0 ? (
        <div className="grid h-24 place-items-center rounded-lg border text-sm text-muted-foreground">
          Query ran successfully and returned no rows.
        </div>
      ) : (
        <div className="max-h-[28rem] overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {result.columns.map((column) => (
                  <TableHead key={column} className="whitespace-nowrap font-mono text-xs first:pl-4 last:pr-4">
                    {column}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {result.columns.map((column) => (
                    <TableCell
                      key={column}
                      className="max-w-72 truncate font-mono text-xs first:pl-4 last:pr-4"
                      title={formatCell(row[column])}
                    >
                      {formatCell(row[column])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
