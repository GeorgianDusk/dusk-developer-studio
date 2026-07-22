import { ArrowUpRight, CheckCircle2, Clipboard, Search } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import type { JourneyStatus } from "./journeyProgress";
import type { Tone } from "./types";

export type AsyncState = "idle" | "loading" | "success" | "empty" | "partial" | "stale" | "timeout" | "error" | "unavailable";

export function toneForStatus(status: JourneyStatus): Tone {
  return status === "verified" || status === "passed-automatically" || status === "confirmed-manually"
    ? "good"
    : status === "blocked"
      ? "danger"
      : status === "ready"
        ? "warn"
        : "neutral";
}

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={"status-pill " + tone}><span className="state-sprite" aria-hidden="true" />{children}</span>;
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const latestAttemptRef = useRef(0);
  const resetTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => {
    latestAttemptRef.current += 1;
    if (resetTimerRef.current !== undefined) window.clearTimeout(resetTimerRef.current);
  }, []);
  async function copy() {
    const attempt = ++latestAttemptRef.current;
    if (resetTimerRef.current !== undefined) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = undefined;
    setFailed(false);
    setCopied(false);
    try {
      await navigator.clipboard.writeText(value);
      if (attempt !== latestAttemptRef.current) return;
      setFailed(false);
      setCopied(true);
      resetTimerRef.current = window.setTimeout(() => {
        if (attempt === latestAttemptRef.current) setCopied(false);
        resetTimerRef.current = undefined;
      }, 1_400);
    } catch {
      if (attempt !== latestAttemptRef.current) return;
      setFailed(true);
      setCopied(false);
    }
  }
  const buttonLabel = failed ? `${label}. Clipboard access failed; retry copy.` : label;
  return <span className="copy-control"><button className="copy-button" type="button" onClick={copy} aria-label={buttonLabel}>{copied ? <CheckCircle2 size={16} /> : <Clipboard size={16} />}<span>{copied ? "Copied" : failed ? "Copy failed - retry" : "Copy"}</span></button><span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{copied ? `${label} copied to clipboard.` : ""}</span>{failed ? <span className="sr-only" role="alert">Clipboard access failed. Select and copy the text manually, or retry this button.</span> : null}</span>;
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a className="text-link" href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={14} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>;
}

export function SearchBox({ value, onChange, placeholder, inputRef }: { value: string; onChange: (value: string) => void; placeholder: string; inputRef?: Ref<HTMLInputElement> }) {
  return <label className="search-field"><Search size={16} /><span className="sr-only">Search</span><input ref={inputRef} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

export function AsyncNotice({ state, title, message, onRetry }: { state: AsyncState; title?: string; message: string; onRetry?: () => void | Promise<void> }) {
  const urgent = state === "error" || state === "timeout" || state === "unavailable";
  return <div className={`async-notice ${state}`} role={urgent ? "alert" : "status"} aria-live={urgent ? "assertive" : "polite"} aria-atomic="true">
    <StatusPill tone={state === "success" ? "good" : urgent ? "danger" : state === "partial" || state === "stale" ? "warn" : "neutral"}>{state}</StatusPill>
    <div>{title ? <strong>{title}</strong> : null}<p>{message}</p></div>
    {onRetry ? <button className="secondary-button" type="button" onClick={onRetry}>Retry</button> : null}
  </div>;
}

export function MiniSteps({ items }: { items: string[] }) {
  return <div className="mini-steps">{items.map((item, index) => <div key={item}><strong>{index + 1}</strong><span>{item}</span></div>)}</div>;
}

export function CommandPair({ firstTitle, first, secondTitle, second }: { firstTitle: string; first: string; secondTitle: string; second: string }) {
  return <div className="command-pair"><div><h3>{firstTitle}</h3><pre>{first}</pre><CopyButton value={first} label={"Copy " + firstTitle} /></div><div><h3>{secondTitle}</h3><pre>{second}</pre><CopyButton value={second} label={"Copy " + secondTitle} /></div></div>;
}

export function PageIntro({ kicker, title, copy }: { kicker: string; title: string; copy: string }) {
  return <div className="page-intro"><span className="section-kicker">{kicker}</span><h1 data-route-heading tabIndex={-1}>{title}</h1><p>{copy}</p></div>;
}
