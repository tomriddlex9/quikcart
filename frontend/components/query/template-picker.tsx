"use client";

import { useMemo } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { SqlTemplate } from "@/lib/sql-templates";

const LEVEL_LABELS: Record<SqlTemplate["level"], string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  lakehouse: "Lakehouse marts",
};

const LEVEL_ORDER: SqlTemplate["level"][] = ["beginner", "intermediate", "advanced", "lakehouse"];

export function TemplatePicker({
  templates,
  selectedId,
  onSelect,
}: {
  templates: SqlTemplate[];
  selectedId: string | null;
  onSelect: (template: SqlTemplate) => void;
}) {
  const grouped = useMemo(() => {
    const byLevel = new Map<SqlTemplate["level"], SqlTemplate[]>();
    for (const template of templates) {
      const bucket = byLevel.get(template.level) ?? [];
      bucket.push(template);
      byLevel.set(template.level, bucket);
    }
    return LEVEL_ORDER.map((level) => ({ level, templates: byLevel.get(level) ?? [] })).filter(
      (group) => group.templates.length > 0,
    );
  }, [templates]);

  return (
    <Command className="rounded-lg border" shouldFilter>
      <CommandInput placeholder={`Search ${templates.length} template questions…`} />
      <CommandList className="max-h-64">
        <CommandEmpty>No template matches that search.</CommandEmpty>
        {grouped.map((group) => (
          <CommandGroup key={group.level} heading={LEVEL_LABELS[group.level]}>
            {group.templates.map((template) => (
              <CommandItem
                key={template.id}
                value={template.question}
                data-checked={template.id === selectedId}
                onSelect={() => onSelect(template)}
              >
                <span className="min-w-0 flex-1 truncate">{template.question}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}
