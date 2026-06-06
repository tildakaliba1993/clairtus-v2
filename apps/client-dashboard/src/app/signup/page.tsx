import type { ReactElement } from 'react';
import { SignupForm } from '../../components/SignupForm';

export default function SignupPage(): ReactElement {
  return (
    <section className="mx-auto max-w-md">
      <h1 className="font-heading mb-1 text-2xl font-bold text-foreground">Create your account</h1>
      <p className="text-muted mb-6 text-sm">
        Sign up to provision your tenant and API keys — sandbox first, go live when you&apos;re ready.
      </p>
      <SignupForm />
    </section>
  );
}
