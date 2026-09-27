"use client";

/**
 * Category pickers stacked top→bottom *above* the panel.
 *
 * Do not use Tabs `orientation="vertical"` — that places the list beside content
 * (left sidebar). These wrappers keep the root as a column and force the list
 * into a full-width vertical stack.
 */

import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ComponentProps } from "react";

function StackedTabs({ className, ...props }: ComponentProps<typeof Tabs>) {
  return <Tabs className={cn("flex flex-col gap-3", className)} {...props} />;
}

function StackedTabsList({
  className,
  variant = "line",
  ...props
}: ComponentProps<typeof TabsList>) {
  return (
    <TabsList
      variant={variant}
      className={cn(
        "flex h-auto w-full flex-col items-stretch justify-start gap-1 rounded-lg bg-muted/40 p-1",
        "group-data-horizontal/tabs:h-auto",
        className,
      )}
      {...props}
    />
  );
}

function StackedTabsTrigger({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
  return (
    <TabsTrigger
      className={cn(
        "h-auto w-full flex-none justify-start whitespace-normal px-3 py-2 text-left",
        "data-active:bg-background data-active:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

function StackedTabsContent({ className, ...props }: ComponentProps<typeof TabsContent>) {
  return <TabsContent className={cn("mt-0", className)} {...props} />;
}

export { StackedTabs, StackedTabsList, StackedTabsTrigger, StackedTabsContent };
