import { Suspense } from "react";
import LoginForm from "./login-form";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-16">
          <p className="w-full text-center text-sm text-zinc-600">Loading...</p>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
