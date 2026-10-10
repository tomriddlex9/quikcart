import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginScreen } from "@/components/login-screen";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">
          Loading sign in…
        </div>
      }
    >
      <LoginScreen />
    </Suspense>
  );
}
