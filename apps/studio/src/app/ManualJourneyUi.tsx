import { CheckCircle2, Circle, Laptop, ShieldCheck, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import {
  manualToolsFor,
  type ManualPlatform,
  type ManualToolRequirement,
  type ManualToolScope
} from "./manualJourneyConfig";
import { CopyButton, ExternalLink, StatusPill } from "./StudioUi";

export type CompletionMethod = "manual" | "automatic";

export function CompletionMethodPicker({
  value,
  onChange,
  automaticAvailable,
  disabled = false,
  automaticLabel = "Local Studio",
  automaticDescription = "Allowlisted local checks with bounded, redacted results.",
  automaticAvailabilityLabel = automaticAvailable ? "available locally" : "start with npm"
}: {
  value: CompletionMethod;
  onChange: (method: CompletionMethod) => void;
  automaticAvailable: boolean;
  disabled?: boolean;
  automaticLabel?: string;
  automaticDescription?: string;
  automaticAvailabilityLabel?: string;
}) {
  return (
    <div className="method-picker" role="group" aria-label="Choose how to complete this task">
      <button
        className={value === "manual" ? "method-option active" : "method-option"}
        type="button"
        aria-pressed={value === "manual"}
        disabled={disabled}
        onClick={() => onChange("manual")}
      >
        <Laptop size={18} aria-hidden="true" />
        <span><strong>Manual now</strong><small>Commands, expected results, and a clearly labeled manual record.</small></span>
        <StatusPill tone="good">available</StatusPill>
      </button>
      <button
        className={value === "automatic" ? "method-option active" : "method-option"}
        type="button"
        aria-pressed={value === "automatic"}
        disabled={disabled}
        onClick={() => onChange("automatic")}
      >
        <ShieldCheck size={18} aria-hidden="true" />
        <span><strong>{automaticLabel}</strong><small>{automaticDescription}</small></span>
        <StatusPill tone={automaticAvailable ? "good" : "neutral"}>{automaticAvailabilityLabel}</StatusPill>
      </button>
    </div>
  );
}

export function PlatformPicker({ value, onChange, disabled = false }: { value: ManualPlatform; onChange: (platform: ManualPlatform) => void; disabled?: boolean }) {
  return (
    <div className="platform-picker" role="group" aria-label="Command platform">
      <button type="button" disabled={disabled} className={value === "windows" ? "active" : ""} aria-pressed={value === "windows"} onClick={() => onChange("windows")}>Windows PowerShell</button>
      <button type="button" disabled={disabled} className={value === "linux" ? "active" : ""} aria-pressed={value === "linux"} onClick={() => onChange("linux")}>Linux shell</button>
      <button type="button" disabled={disabled} className={value === "macos" ? "active" : ""} aria-pressed={value === "macos"} onClick={() => onChange("macos")}>macOS shell</button>
    </div>
  );
}

function RequirementPill({ requirement }: Pick<ManualToolRequirement, "requirement">) {
  return <StatusPill tone={requirement === "required" ? "warn" : "neutral"}>{requirement}</StatusPill>;
}

export function ManualToolChecklist({
  scope,
  platform,
  confirmed,
  onToggle
}: {
  scope: ManualToolScope;
  platform: ManualPlatform;
  confirmed: Set<string>;
  onToggle: (toolId: string) => void;
}) {
  const tools = manualToolsFor(scope).filter((tool) => tool.id !== "wsl" || platform === "windows");
  const required = tools.filter((tool) => tool.requirement === "required");
  const supporting = tools.filter((tool) => tool.requirement !== "required");
  return (
    <div className="manual-checklist">
      <div className="checklist-heading">
        <div>
          <h3>{scope === "setup" ? "Required tool checks" : "Tools used in this step"}</h3>
          <p>Run each command yourself. Studio records only your confirmation and the bounded details you provide.</p>
        </div>
        <strong>{required.filter((tool) => confirmed.has(tool.id)).length}/{required.length} required checked</strong>
      </div>
      <div className="manual-tool-list">
        {required.map((tool) => (
          <ManualToolRow key={tool.id} tool={tool} platform={platform} checked={confirmed.has(tool.id)} onToggle={onToggle} />
        ))}
      </div>
      {supporting.length ? (
        <details className="supporting-tools">
          <summary><Wrench size={16} aria-hidden="true" />Conditional and optional tools ({supporting.length})</summary>
          <div className="manual-tool-list">
            {supporting.map((tool) => (
              <ManualToolRow key={tool.id} tool={tool} platform={platform} checked={confirmed.has(tool.id)} onToggle={onToggle} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ManualToolRow({
  tool,
  platform,
  checked,
  onToggle
}: {
  tool: ManualToolRequirement;
  platform: ManualPlatform;
  checked: boolean;
  onToggle: (toolId: string) => void;
}) {
  return (
    <article className={checked ? "manual-tool-row checked" : "manual-tool-row"}>
      <button
        className="tool-check-toggle"
        type="button"
        aria-label={`${checked ? "Unmark" : "Mark"} ${tool.name} as checked`}
        aria-pressed={checked}
        onClick={() => onToggle(tool.id)}
      >
        {checked ? <CheckCircle2 size={18} aria-hidden="true" /> : <Circle size={18} aria-hidden="true" />}
        <span>{checked ? "Checked" : "Mark checked"}</span>
      </button>
      <div className="manual-tool-copy">
        <div className="manual-tool-title"><strong>{tool.name}</strong><RequirementPill requirement={tool.requirement} /></div>
        <p>{tool.purpose}</p>
        <small>Reviewed identity: {tool.reviewedIdentity}</small>
        <details>
          <summary>Commands and expected result</summary>
          <div className="tool-command">
            <span>Check</span>
            <pre>{tool.checkCommand[platform]}</pre>
            <CopyButton value={tool.checkCommand[platform]} label={`Copy ${tool.name} check command`} />
          </div>
          {tool.installCommand ? (
            <div className="tool-command">
              <span>Install or repair</span>
              <pre>{tool.installCommand[platform]}</pre>
              <CopyButton value={tool.installCommand[platform]} label={`Copy ${tool.name} install command`} />
            </div>
          ) : null}
          <p className="expected-result"><strong>Expected:</strong> {tool.expectedResult}</p>
          <ExternalLink href={tool.helpUrl}>Installation and help</ExternalLink>
        </details>
      </div>
    </article>
  );
}

export function ManualRecordNotice({ children }: { children?: ReactNode }) {
  return (
    <div className="manual-record-notice">
      <StatusPill tone="neutral">manual confirmation</StatusPill>
      <p>{children ?? "Studio validates the form and stores a browser-local confirmation. It cannot prove that the terminal command ran."}</p>
    </div>
  );
}
