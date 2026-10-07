import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <PageHeader
        title="Page not found"
        description="This route is not part of the QuickCart console."
      />
      <EmptyState
        title="404"
        hint="This page does not exist in the console. The pipeline stages are all accounted for — the route you asked for is not one of them."
        action={
          <Button variant="outline" size="sm" render={<Link href="/" />}>
            Back to overview
          </Button>
        }
      />
    </main>
  );
}
