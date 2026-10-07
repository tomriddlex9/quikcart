"use client";

import { useRouter } from "next/navigation";
import { Bot, Command as CommandIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { askHref } from "@/components/business/ask-about-button";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { BUSINESS_NAV } from "@/lib/business-nav";

/**
 * ⌘K palette for the business shell.
 * Typing a leading `?` switches to Ask mode and sends the rest to `/b/ask`.
 */
export function BusinessCommand() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const askText = query.trim().startsWith("?") ? query.trim().slice(1).trim() : "";
  const askMode = query.trim().startsWith("?");

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2 text-muted-foreground"
        onClick={() => setOpen(true)}
        aria-label="Search or ask"
      >
        <CommandIcon className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">Ask / jump</span>
        <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium sm:inline-flex">
          ⌘K
        </kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Jump to a page, or type ? then a question…"
        />
        <CommandList>
          <CommandEmpty>
            {askMode
              ? "Press Enter on Ask to send your question."
              : "No page found. Prefix with ? to ask."}
          </CommandEmpty>
          {askMode ? (
            <CommandGroup heading="Ask">
              <CommandItem
                value={`ask ${askText}`}
                onSelect={() => go(askHref(askText || "How is today looking?"))}
              >
                <Bot className="size-4" aria-hidden />
                <span>{askText ? `Ask: ${askText}` : "Open Ask center"}</span>
              </CommandItem>
            </CommandGroup>
          ) : (
            <>
              <CommandGroup heading="Ask">
                <CommandItem value="ask center ?" onSelect={() => go("/b/ask")}>
                  <Bot className="size-4" aria-hidden />
                  <span>Ask center</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    type ? for a question
                  </span>
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Pages">
                {BUSINESS_NAV.map((item) => (
                  <CommandItem
                    key={item.href}
                    value={`${item.label} ${item.hint ?? ""}`}
                    onSelect={() => go(item.href)}
                  >
                    <item.icon className="size-4" aria-hidden />
                    <span>{item.label}</span>
                    {item.hint ? (
                      <span className="ml-auto text-xs text-muted-foreground">{item.hint}</span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
