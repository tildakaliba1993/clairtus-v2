"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface TransactionActionPanelProps {
  transactionId: string;
  canForcePayout: boolean;
  canForceRefund: boolean;
  canResumeAutomation: boolean;
}

type AdminAction = "force_payout" | "force_refund" | "resume_automation";

const ACTION_LABELS: Record<AdminAction, string> = {
  force_payout: "Force Payout",
  force_refund: "Force Refund",
  resume_automation: "Resume Automation",
};

export function TransactionActionPanel(props: TransactionActionPanelProps) {
  const router = useRouter();
  const [pending, setPending] = useState<AdminAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAction(action: AdminAction) {
    const confirmed = window.confirm(
      `Confirm action: ${ACTION_LABELS[action]} for transaction ${props.transactionId}?`,
    );
    if (!confirmed) {
      return;
    }

    setPending(action);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/admin/transactions/${props.transactionId}/actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );

      const body = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;

      if (!response.ok || body?.ok === false) {
        throw new Error(body?.error ?? "Action failed.");
      }

      setMessage(`${ACTION_LABELS[action]} initiated successfully.`);
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-zinc-900">Manual Intervention</h2>
      <p className="mt-2 text-sm text-zinc-600">
        Use these controls only when automated flow needs admin intervention.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!props.canForcePayout || pending !== null}
          onClick={() => runAction("force_payout")}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending === "force_payout" ? "Processing..." : "Force Payout"}
        </button>

        <button
          type="button"
          disabled={!props.canForceRefund || pending !== null}
          onClick={() => runAction("force_refund")}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending === "force_refund" ? "Processing..." : "Force Refund"}
        </button>

        <button
          type="button"
          disabled={!props.canResumeAutomation || pending !== null}
          onClick={() => runAction("resume_automation")}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending === "resume_automation" ? "Processing..." : "Resume Automation"}
        </button>
      </div>

      {message ? (
        <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
