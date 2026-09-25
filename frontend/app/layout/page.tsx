import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { LAYOUT_NOTE, TREE } from "@/lib/learn/layout";

export const metadata: Metadata = { title: "Repository layout" };

const KIND_LABEL = {
  source: "source",
  spec: "specification",
  runtime: "runtime",
  docs: "docs",
  tests: "tests",
} as const;

export default function RepoLayoutPage() {
  return (
    <>
      <PageHeader
        title="Repository layout"
        description="Where the code, the specification, the tests, and the generated lakehouse live."
      />

      <p className="mb-4 max-w-[70ch] text-sm text-muted-foreground">{LAYOUT_NOTE}</p>

      <Accordion className="border-t border-border">
        {TREE.map((node) => (
          <AccordionItem key={node.path} value={node.path}>
            <AccordionTrigger className="gap-3 hover:no-underline">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <code className="text-sm">{node.path}</code>
                <Badge variant="secondary" className="ml-auto shrink-0 font-normal">
                  {KIND_LABEL[node.kind]}
                </Badge>
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-sm">
              <p className="text-muted-foreground">{node.summary}</p>
              {node.children ? (
                <ul className="mt-2 space-y-1">
                  {node.children.map((child) => (
                    <li key={child.path} className="text-xs">
                      <code>{child.path}</code>
                      <span className="text-muted-foreground"> — {child.summary}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </>
  );
}
