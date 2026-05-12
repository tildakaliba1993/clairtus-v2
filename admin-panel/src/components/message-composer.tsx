"use client";

import { FormEvent, useMemo, useState } from "react";

interface MessageComposerProps {
  defaultRecipientPhone?: string;
}

interface MessageTemplate {
  id: string;
  title: string;
  body: string;
}

const MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    id: "deposit_reminder",
    title: "Deposit Reminder",
    body: "Rappel Clairtus: veuillez finaliser votre depot Mobile Money pour poursuivre la transaction.",
  },
  {
    id: "human_follow_up",
    title: "Human Support Follow-up",
    body: "Votre dossier est en cours de traitement par notre equipe support. Merci pour votre patience.",
  },
  {
    id: "action_required",
    title: "Action Required",
    body: "Action requise: veuillez confirmer les informations de transaction pour que nous puissions avancer.",
  },
];

const MAX_MESSAGE_CHARS = 4096;

export function MessageComposer({ defaultRecipientPhone = "" }: MessageComposerProps) {
  const [recipientPhone, setRecipientPhone] = useState(defaultRecipientPhone);
  const [messageText, setMessageText] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryPayload, setRetryPayload] = useState<{
    recipientPhone: string;
    messageText: string;
  } | null>(null);

  const remainingChars = useMemo(
    () => MAX_MESSAGE_CHARS - messageText.length,
    [messageText.length],
  );

  function applyTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    const template = MESSAGE_TEMPLATES.find((item) => item.id === templateId);
    if (template) {
      setMessageText(template.body);
    }
  }

  async function submitPayload(payload: { recipientPhone: string; messageText: string }) {
    setIsSubmitting(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/admin/messages/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipient_phone: payload.recipientPhone,
          message_text: payload.messageText,
        }),
      });

      const body = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!response.ok || body?.ok === false) {
        throw new Error(body?.error ?? "Failed to send message.");
      }

      setSuccessMessage("Message sent successfully.");
      setRetryPayload(null);
      setMessageText("");
      setSelectedTemplateId("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Message send failed.";
      setErrorMessage(message);
      setRetryPayload(payload);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload = {
      recipientPhone: recipientPhone.trim(),
      messageText: messageText.trim(),
    };
    if (!payload.recipientPhone || !payload.messageText) {
      setErrorMessage("Recipient phone and message are required.");
      return;
    }
    if (payload.messageText.length > MAX_MESSAGE_CHARS) {
      setErrorMessage(`Message exceeds ${MAX_MESSAGE_CHARS} characters.`);
      return;
    }

    const confirmed = window.confirm(
      `Send this message to ${payload.recipientPhone}?`,
    );
    if (!confirmed) {
      return;
    }

    await submitPayload(payload);
  }

  async function retryLastFailure() {
    if (!retryPayload || isSubmitting) {
      return;
    }

    const confirmed = window.confirm(
      `Retry sending message to ${retryPayload.recipientPhone}?`,
    );
    if (!confirmed) {
      return;
    }

    await submitPayload(retryPayload);
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-zinc-900">Compose Message</h2>
      <p className="mt-1 text-sm text-zinc-600">
        Send custom WhatsApp messages to users in E.164 format (+243...).
      </p>

      <form className="mt-4 space-y-4" onSubmit={onSubmit}>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-zinc-700">Recipient phone</span>
          <input
            type="text"
            value={recipientPhone}
            onChange={(event) => setRecipientPhone(event.target.value)}
            placeholder="+243..."
            required
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-700"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-zinc-700">Template library</span>
          <select
            value={selectedTemplateId}
            onChange={(event) => applyTemplate(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-700"
          >
            <option value="">Select a template (optional)</option>
            {MESSAGE_TEMPLATES.map((template) => (
              <option key={template.id} value={template.id}>
                {template.title}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-zinc-700">Message text</span>
          <textarea
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
            required
            rows={6}
            maxLength={MAX_MESSAGE_CHARS}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-700"
          />
          <span className="mt-1 block text-xs text-zinc-500">
            {remainingChars} characters remaining
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Sending..." : "Send message"}
          </button>
          <button
            type="button"
            disabled={!retryPayload || isSubmitting}
            onClick={retryLastFailure}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Retry last failure
          </button>
        </div>
      </form>

      {successMessage ? (
        <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {successMessage}
        </p>
      ) : null}
      {errorMessage ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
}
