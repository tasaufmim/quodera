"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ByoKeyField, storedByKeyKey } from "./ByoKeyField";
import { CitationPanel } from "./CitationPanel";
import { MessageBubble } from "./MessageBubble";
import type { CitationRef } from "@/lib/citation";
import { readSse } from "@/lib/sse";

/**
 * The chat workspace: threads, streaming SSE answers with live [n] markers,
 * the citation panel, and honest error copy for every quota/availability
 * state (the 429 names the BYO upgrade — ADR 0007's honest upsell).
 */

interface ThreadSummary {
  id: string;
  title: string | null;
}

interface ChatMessageState {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Map<number, CitationRef>;
  uncited?: boolean;
}

interface DoneEvent {
  threadId: string;
  messageId?: string;
  refused?: boolean;
  uncited?: boolean;
}

export function ChatWorkspace({ initialThreads }: { initialThreads: ThreadSummary[] }) {
  const [threads, setThreads] = useState<ThreadSummary[]>(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatMessageState[]>([]);
  const [streamText, setStreamText] = useState<string>("");
  const [streaming, setStreaming] = useState(false);
  const [streamCitations, setStreamCitations] = useState<Map<number, CitationRef>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CitationRef | null>(null);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, streamText]);

  const selectThread = useCallback(async (threadId: string | null) => {
    setSelected(null);
    setStreamText("");
    setError(null);
    if (!threadId) {
      setActiveThreadId(null);
      setHistory([]);
      return;
    }
    setActiveThreadId(threadId);
    const response = await fetch(`/api/threads/${threadId}/messages`);
    if (!response.ok) {
      setHistory([]);
      return;
    }
    const body = (await response.json()) as {
      messages: Array<{
        id: string;
        role: "user" | "assistant";
        content: string;
        citations: Array<CitationRef & { marker: number }>;
      }>;
    };
    setHistory(
      body.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        citations: new Map(message.citations.map((c) => [c.marker, c as CitationRef])),
      })),
    );
  }, []);

  async function send() {
    const content = draft.trim();
    if (!content || streaming) return;

    setDraft("");
    setError(null);
    setSelected(null);
    setHistory((previous) => [
      ...previous,
      { id: `local-${Date.now()}`, role: "user", content, citations: new Map() },
    ]);
    setStreaming(true);
    setStreamText("");
    setStreamCitations(new Map());

    const headers: Record<string, string> = { "content-type": "application/json" };
    const byo = storedByKeyKey();
    if (byo) headers["x-openrouter-key"] = byo;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({ threadId: activeThreadId ?? undefined, content }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          setError(
            byo
              ? "Rate limit reached — try again shortly."
              : "Daily demo limit reached (5 messages/day). Add your own OpenRouter key above to keep chatting.",
          );
        } else if (response.status === 503) {
          setError(
            "Chat is not configured on this deployment (no OpenRouter key). BYO works if you add one above.",
          );
        } else {
          setError("Chat failed — please try again.");
        }
        return;
      }

      let answer = "";
      const pendingCitations = new Map<number, CitationRef>();
      // closure assignments defeat TS control-flow analysis — hold state in an
      // object so the post-stream reads stay typed
      const state: { done: DoneEvent | null } = { done: null };

      await readSse(response, (name, data) => {
        if (name === "token") {
          answer += String((data as { text?: string }).text ?? "");
          setStreamText(answer);
        } else if (name === "citations") {
          const list =
            (data as { citations?: Array<CitationRef & { marker: number }> }).citations ?? [];
          for (const citation of list) {
            pendingCitations.set(citation.marker, citation);
          }
          setStreamCitations(new Map(pendingCitations));
        } else if (name === "done") {
          state.done = data as unknown as DoneEvent;
        } else if (name === "error") {
          setError("Generation failed mid-answer — please try again.");
        }
      });

      const doneEvent = state.done;
      if (answer.length > 0 && doneEvent) {
        setHistory((previous) => [
          ...previous,
          {
            id: doneEvent.messageId ?? `assistant-${Date.now()}`,
            role: "assistant" as const,
            content: answer,
            citations: new Map(pendingCitations),
            uncited: Boolean(doneEvent.uncited),
          },
        ]);
        if (!activeThreadId && doneEvent.threadId) {
          const newThreadId = doneEvent.threadId;
          setActiveThreadId(newThreadId);
          setThreads((previous) => [{ id: newThreadId, title: content.slice(0, 60) }, ...previous]);
        }
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setStreaming(false);
      setStreamText("");
      setStreamCitations(new Map());
    }
  }

  return (
    <div className="flex min-h-[70vh] gap-6">
      {/* threads sidebar */}
      <nav className="hidden w-56 shrink-0 flex-col gap-2 lg:flex">
        <button
          type="button"
          onClick={() => void selectThread(null)}
          className={`rounded-lg border px-3 py-2 text-left text-sm ${
            activeThreadId === null ? "border-primary bg-surface" : "border-line"
          }`}
        >
          + New chat
        </button>
        {threads.map((thread) => (
          <button
            key={thread.id}
            type="button"
            onClick={() => void selectThread(thread.id)}
            className={`truncate rounded-lg border px-3 py-2 text-left text-sm ${
              activeThreadId === thread.id ? "border-primary bg-surface" : "border-line"
            } text-ink-muted`}
          >
            {thread.title ?? "Untitled"}
          </button>
        ))}
      </nav>

      {/* chat + citation panel */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto py-2">
            {history.map((message) => (
              <MessageBubble
                key={message.id}
                role={message.role}
                content={message.content}
                citations={message.citations}
                uncited={message.uncited}
                onCitation={setSelected}
              />
            ))}
            {streaming && streamText.length > 0 ? (
              <MessageBubble
                role="assistant"
                content={streamText}
                citations={streamCitations}
                streaming
                onCitation={setSelected}
              />
            ) : null}
            <div ref={bottomRef} />
          </div>

          {error ? (
            <p className="rounded-lg border border-line bg-raised px-3 py-2 text-sm text-ink-muted">
              {error}
            </p>
          ) : null}

          <div className="mt-3 flex items-center gap-3">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder={
                history.length === 0 && !activeThreadId ? "Ask about your documents…" : "Follow up…"
              }
              className="min-h-0 flex-1 resize-none rounded-lg border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={streaming || draft.trim().length === 0}
              className="shrink-0 rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-ink transition hover:opacity-90 disabled:opacity-60"
            >
              {streaming ? "…" : "Ask"}
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <ByoKeyField />
            <span className="text-xs text-ink-muted">every claim cites its source — [n]</span>
          </div>
        </div>

        {selected ? <CitationPanel citation={selected} /> : null}
      </div>
    </div>
  );
}
