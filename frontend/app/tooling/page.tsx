import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MAKE_TARGETS, NOT_IN_MAKE, SERVICES } from "@/lib/learn/tooling";

export const metadata: Metadata = { title: "Tooling" };

export default function ToolingPage() {
  return (
    <>
      <PageHeader
        title="Tooling"
        description="How each process starts, which Compose profile owns it, and which host port it binds. Profiles are opt-in."
      />

      <Tabs defaultValue="services" className="gap-4">
        <TabsList>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="make">Make targets</TabsTrigger>
          <TabsTrigger value="manual">Not in the Makefile</TabsTrigger>
        </TabsList>

        <TabsContent value="services">
          <Card size="sm" className="py-0">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4 text-xs text-muted-foreground">Service</TableHead>
                  <TableHead className="text-xs text-muted-foreground">Profile</TableHead>
                  <TableHead className="text-xs text-muted-foreground">Port</TableHead>
                  <TableHead className="text-xs text-muted-foreground">Start</TableHead>
                  <TableHead className="text-xs text-muted-foreground">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {SERVICES.map((row) => (
                  <TableRow key={row.name} className="align-top">
                    <TableCell className="pl-4 font-medium">{row.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">
                        {row.profile}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.port}</TableCell>
                    <TableCell className="font-mono text-xs text-chart-2">{row.start}</TableCell>
                    <TableCell className="max-w-[46ch] whitespace-normal text-xs text-muted-foreground">
                      {row.notes}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="make">
          <Card size="sm" className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4 text-xs text-muted-foreground">Target</TableHead>
                  <TableHead className="text-xs text-muted-foreground">What it does</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {MAKE_TARGETS.map((row) => (
                  <TableRow key={row.target}>
                    <TableCell className="pl-4 font-mono text-xs">{row.target}</TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">
                      {row.does}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="manual">
          <ul className="space-y-2">
            {NOT_IN_MAKE.map((item) => (
              <li key={item} className="rounded-lg border border-border px-4 py-3 text-sm">
                {item}
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>
    </>
  );
}
