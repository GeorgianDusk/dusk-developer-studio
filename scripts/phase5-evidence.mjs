import { URL } from "node:url";

const SHA256_RE = /^[a-f0-9]{64}$/;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const UNASSIGNED_RE = /^(?:tbd|todo|unknown|unassigned|pending)$/i;
const SECRET_KEY_RE = /(?:private[_-]?key|mnemonic|seed(?:er|phrase)?|profile[_-]?entropy|wallet[_-]?password|pairing[_-]?token|api[_-]?key|secret)/i;

function present(value) {
  return typeof value === "string" && value.trim().length > 0 && !UNASSIGNED_RE.test(value.trim());
}

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function freshDate(value, now, maxAgeMilliseconds) {
  if (!validDate(value) || !Number.isFinite(maxAgeMilliseconds) || maxAgeMilliseconds <= 0) return false;
  const observed = Date.parse(value);
  return observed <= now.getTime() && observed >= now.getTime() - maxAgeMilliseconds;
}

function expectedActionsRunUrl(value, repository) {
  if (!present(value) || !present(repository)) return false;
  try {
    const url = new URL(value);
    const prefix = `/${repository}/actions/runs/`;
    return url.protocol === "https:" && url.hostname === "github.com" && url.pathname.startsWith(prefix) && /^\d+\/?$/.test(url.pathname.slice(prefix.length));
  } catch {
    return false;
  }
}

function expectedDirectHealthTarget(value, manifestUrl) {
  try {
    const target = new URL(value);
    const manifest = new URL(manifestUrl);
    return target.protocol === "https:"
      && !target.username
      && !target.password
      && !target.port
      && target.href === `${target.origin}/healthz`
      && manifest.protocol === "https:"
      && !manifest.username
      && !manifest.password
      && !manifest.port
      && target.origin === manifest.origin;
  } catch {
    return false;
  }
}

function checkForSecretFields(value, path = "evidence", findings = []) {
  if (Array.isArray(value)) value.forEach((item, index) => checkForSecretFields(item, `${path}[${index}]`, findings));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(key)) findings.push(`${path}.${key}`);
      checkForSecretFields(item, `${path}.${key}`, findings);
    }
  }
  return findings;
}

function checkSteps(blockers, label, steps, required) {
  if (!steps || typeof steps !== "object") {
    blockers.push(`${label} steps are missing.`);
    return;
  }
  for (const step of required) if (steps[step] !== "passed") blockers.push(`${label} step ${step} has not passed.`);
}

function checkException(blockers, issue, now) {
  const exception = issue.exception;
  const required = ["owner", "rationale", "compensating_control", "residual_risk", "monitoring", "expiry", "revalidation_trigger", "accepted_by"];
  if (!exception || required.some((field) => !present(exception[field]))) {
    blockers.push(`Open P1 ${issue.id ?? "unknown"} has no complete exception.`);
    return;
  }
  if (exception.accepted_by !== "George" || !validDate(exception.expiry)) {
    blockers.push(`Open P1 ${issue.id ?? "unknown"} has an invalid product-owner acceptance or expiry.`);
    return;
  }
  const expiry = Date.parse(exception.expiry);
  if (expiry <= now.getTime() || expiry > now.getTime() + 30 * 24 * 60 * 60 * 1000) {
    blockers.push(`Open P1 ${issue.id ?? "unknown"} exception must be active and expire within 30 days.`);
  }
}

export function evaluatePhase5Evidence(policy, evidence, options = {}) {
  const now = options.now ?? new Date();
  const blockers = [];
  if (!policy || policy.schema_version !== 1) blockers.push("Phase 5 policy schema is unsupported.");
  if (!evidence || evidence.schema_version !== 1) blockers.push("Phase 5 evidence schema is unsupported.");
  if (blockers.length) return { decision: "no-go", blockers };

  const secretFields = checkForSecretFields(evidence);
  if (secretFields.length) blockers.push(`Evidence contains forbidden secret-shaped fields: ${secretFields.join(", ")}.`);

  const candidate = evidence.candidate ?? {};
  if (!SHA256_RE.test(candidate.artifact_fingerprint_sha256 ?? "")) blockers.push("Candidate artifact fingerprint is invalid.");
  if (!SHA256_RE.test(candidate.public_fingerprint_sha256 ?? "")) blockers.push("Public artifact fingerprint is invalid.");
  if (candidate.artifact_fingerprint_sha256 !== candidate.public_fingerprint_sha256) blockers.push("Candidate and public artifact fingerprints differ.");
  if (!COMMIT_RE.test(candidate.commit ?? "")) blockers.push("Candidate must identify one clean full Git commit.");
  if (!present(candidate.manifest_url) || !candidate.manifest_url.startsWith("https://")) blockers.push("Candidate manifest URL must be HTTPS.");
  else {
    try {
      const host = new URL(candidate.manifest_url).hostname;
      if (!policy.candidate_hosts.includes(host)) blockers.push(`Candidate host ${host} is not approved by policy.`);
    } catch {
      blockers.push("Candidate manifest URL is invalid.");
    }
  }
  if (!validDate(candidate.built_at)) blockers.push("Candidate build time is invalid.");
  if (!validDate(candidate.source_checked_at) || !validDate(candidate.source_expires_at)) blockers.push("Candidate source receipt dates are invalid.");
  else if (Date.parse(candidate.source_expires_at) <= now.getTime()) blockers.push("Candidate source receipt is expired.");

  const distributionPolicy = policy.companion_distribution ?? {};
  const distribution = evidence.companion_distribution ?? {};
  if (distribution.hosted_mode !== distributionPolicy.hosted_mode || distribution.hosted_mode !== "docs-only") {
    blockers.push("Hosted Studio companion mode must remain docs-only.");
  }
  if (!distributionPolicy.allowed_availability?.includes(distribution.availability)) {
    blockers.push("Companion distribution availability is not allowed by policy.");
  } else if (distribution.availability === "signed-downloads") {
    for (const target of distributionPolicy.required_targets ?? []) {
      const record = distribution.targets?.[target];
      if (!record || record.signing_status !== "signed" || record.signature_algorithm !== distributionPolicy.required_signatures?.[target]
          || record.signature_verified !== true || record.clean_machine_smoke !== distributionPolicy.clean_machine_smoke_status
          || !SHA256_RE.test(record.archive_sha256 ?? "") || !SHA256_RE.test(record.manifest_sha256 ?? "")) {
        blockers.push(`Signed companion distribution evidence is incomplete for ${target}.`);
      }
    }
  }

  const owners = evidence.owners ?? {};
  for (const owner of policy.required_owners) if (!present(owners[owner])) blockers.push(`Required owner ${owner} is unassigned.`);

  const reviews = evidence.reviews ?? {};
  for (const reviewName of policy.required_reviews) {
    const review = reviews[reviewName];
    if (!review || review.status !== "accepted" || !present(review.reviewer) || !validDate(review.reviewed_at)) {
      blockers.push(`Independent review ${reviewName} is not accepted with reviewer/date evidence.`);
    }
    if (reviewName === "companion_security" && review?.independent !== true) blockers.push("Companion security reviewer is not recorded as independent.");
  }

  const sessions = Array.isArray(evidence.pilot?.sessions) ? evidence.pilot.sessions : [];
  if (sessions.length < policy.pilot.minimum_total) blockers.push(`Pilot has ${sessions.length}/${policy.pilot.minimum_total} required sessions.`);
  const evm = sessions.filter((session) => session.path === "evm");
  const native = sessions.filter((session) => session.path === "native");
  if (evm.length < policy.pilot.minimum_evm) blockers.push(`Pilot has ${evm.length}/${policy.pilot.minimum_evm} required EVM sessions.`);
  if (native.length < policy.pilot.minimum_native) blockers.push(`Pilot has ${native.length}/${policy.pilot.minimum_native} required native sessions.`);
  for (const experience of policy.pilot.required_experience) if (!sessions.some((session) => session.experience === experience)) blockers.push(`Pilot lacks ${experience} experience coverage.`);
  for (const context of policy.pilot.required_contexts) if (!sessions.some((session) => session.context === context)) blockers.push(`Pilot lacks ${context} context coverage.`);
  const completionRate = sessions.length ? sessions.filter((session) => session.completed === true).length / sessions.length : 0;
  if (completionRate < policy.pilot.minimum_completion_rate) blockers.push(`Pilot completion rate ${completionRate.toFixed(2)} is below ${policy.pilot.minimum_completion_rate}.`);
  const recoveryAttempts = sessions.filter((session) => session.recovery_attempted === true);
  const recoveryRate = recoveryAttempts.length ? recoveryAttempts.filter((session) => session.recovered === true).length / recoveryAttempts.length : 0;
  if (!recoveryAttempts.length || recoveryRate < policy.pilot.minimum_recovery_rate) blockers.push(`Pilot recovery rate ${recoveryRate.toFixed(2)} is below ${policy.pilot.minimum_recovery_rate}.`);
  const trustScores = sessions.map((session) => session.trust_score).filter((score) => Number.isFinite(score));
  const averageTrust = trustScores.length === sessions.length && sessions.length ? trustScores.reduce((sum, score) => sum + score, 0) / sessions.length : 0;
  if (averageTrust < policy.pilot.minimum_average_trust_score) blockers.push(`Pilot trust score ${averageTrust.toFixed(2)} is below ${policy.pilot.minimum_average_trust_score}.`);
  const blockingConfusion = sessions.filter((session) => session.blocking_confusion === true).length;
  if (blockingConfusion > policy.pilot.maximum_blocking_confusion) blockers.push(`Pilot recorded ${blockingConfusion} blocking confusion events.`);
  if (sessions.some((session) => !present(session.id) || !Number.isFinite(session.duration_minutes) || session.duration_minutes <= 0)) blockers.push("Every pilot session needs a pseudonymous id and positive duration.");

  const liveSmoke = evidence.live_smoke ?? {};
  if (liveSmoke.status !== "passed" || !present(liveSmoke.authority_reference) || liveSmoke.redacted !== true) blockers.push("Funded Testnet smoke lacks passed status, explicit authority reference, or redaction evidence.");
  checkSteps(blockers, "EVM live smoke", liveSmoke.evm_steps, policy.required_evm_smoke_steps);
  checkSteps(blockers, "Native live smoke", liveSmoke.native_steps, policy.required_native_smoke_steps);

  const synthetics = evidence.synthetics ?? {};
  const checks = synthetics.checks ?? {};
  for (const check of policy.required_synthetic_checks) {
    const result = checks[check];
    if (!result || result.status !== "passed" || !present(result.owner)) blockers.push(`Synthetic check ${check} is not passed with an owner.`);
  }
  const monitoringPolicy = policy.monitoring_evidence ?? {};
  const heartbeat = checks.monitor_heartbeat ?? {};
  const heartbeatMaxAge = monitoringPolicy.monitor_heartbeat_max_age_hours * 60 * 60 * 1_000;
  if (!SHA256_RE.test(heartbeat.receipt_sha256 ?? "")
      || heartbeat.workflow_path !== monitoringPolicy.schedule_guard_workflow
      || !freshDate(heartbeat.observed_at, now, heartbeatMaxAge)
      || !expectedActionsRunUrl(heartbeat.run_url, monitoringPolicy.canonical_repository)) {
    blockers.push("Monitor heartbeat evidence lacks a fresh bound receipt, exact schedule-guard workflow, or canonical Actions run.");
  }
  const external = checks.external_dead_man ?? {};
  const externalSuccessMaxAge = monitoringPolicy.external_success_max_age_hours * 60 * 60 * 1_000;
  const externalRehearsalMaxAge = monitoringPolicy.external_rehearsal_max_age_days * 24 * 60 * 60 * 1_000;
  if (external.outside_github !== true
      || external.success_endpoint_configured !== true
      || !present(external.provider) || /github/i.test(external.provider)
      || !present(external.check_id)
      || !present(external.alert_channel) || /github/i.test(external.alert_channel)
      || external.alert_delivery_verified !== true
      || !freshDate(external.latest_success_at, now, externalSuccessMaxAge)
      || !freshDate(external.missed_ping_rehearsed_at, now, externalRehearsalMaxAge)
      || !present(external.rehearsal_reference)) {
    blockers.push("External dead-man evidence lacks an outside-GitHub provider/check, fresh success, verified out-of-band alert, or recent missed-ping rehearsal.");
  }
  const directHealth = checks.external_direct_health ?? {};
  const directHealthMaxAge = monitoringPolicy.direct_health_max_age_hours * 60 * 60 * 1_000;
  const directAlertAt = Date.parse(directHealth.alert_rehearsed_at);
  const directRecoveredAt = Date.parse(directHealth.recovered_at);
  const directSuccessAt = Date.parse(directHealth.latest_success_at);
  const directRecoveryChronology = Number.isFinite(directAlertAt)
    && Number.isFinite(directRecoveredAt)
    && Number.isFinite(directSuccessAt)
    && directAlertAt < directRecoveredAt
    && directRecoveredAt < directSuccessAt;
  if (directHealth.outside_github !== true
      || !present(directHealth.provider) || /github/i.test(directHealth.provider)
      || !present(directHealth.check_id) || directHealth.check_id === external.check_id
      || !expectedDirectHealthTarget(directHealth.target_url, candidate.manifest_url)
      || directHealth.response_status !== 200
      || directHealth.body_match !== "ok"
      || directHealth.tls_verified !== true
      || !present(directHealth.alert_channel) || /github/i.test(directHealth.alert_channel)
      || directHealth.alert_delivery_verified !== true
      || !freshDate(directHealth.latest_success_at, now, directHealthMaxAge)
      || !freshDate(directHealth.alert_rehearsed_at, now, externalRehearsalMaxAge)
      || directHealth.recovery_verified !== true
      || !freshDate(directHealth.recovered_at, now, externalRehearsalMaxAge)
      || !directRecoveryChronology
      || !present(directHealth.rehearsal_reference)) {
    blockers.push("External direct health evidence lacks a separate outside-GitHub /healthz check, exact target, fresh 200/ok/TLS success, or chronological verified alert-to-recovery proof.");
  }
  if (synthetics.alert_delivery_verified !== true || !validDate(synthetics.checked_at)) blockers.push("Synthetic alert delivery is not verified with a timestamp.");

  for (const kind of ["product", "platform"]) {
    const rollback = evidence.rollback?.[kind];
    if (!rollback || rollback.status !== "passed" || !present(rollback.owner) || !Number.isFinite(rollback.duration_seconds) || rollback.duration_seconds > policy.rollback_targets_seconds[kind]) {
      blockers.push(`${kind} rollback has not passed within ${policy.rollback_targets_seconds[kind]} seconds with an owner.`);
    }
    if (!SHA256_RE.test(rollback?.restored_fingerprint_sha256 ?? "") || !present(rollback?.health_proof) || !present(rollback?.data_cache_effects)) blockers.push(`${kind} rollback evidence is incomplete.`);
  }

  const issues = Array.isArray(evidence.issues) ? evidence.issues : [];
  for (const issue of issues.filter((item) => item.status === "open")) {
    if (issue.severity === "P0") blockers.push(`Open P0 ${issue.id ?? "unknown"} blocks launch.`);
    if (issue.severity === "P1") checkException(blockers, issue, now);
  }

  const support = evidence.support ?? {};
  if (!present(support.on_call_owner) || support.support_channel_confirmed !== true || !present(support.launch_message_owner) || !present(support.incident_message_owner)) blockers.push("Support/on-call/status communication ownership is incomplete.");

  const signoff = evidence.product_signoff ?? {};
  if (signoff.decision !== "go" || signoff.owner !== "George" || !validDate(signoff.signed_at) || signoff.artifact_fingerprint_sha256 !== candidate.artifact_fingerprint_sha256) {
    blockers.push("Product go/no-go sign-off is missing or does not bind the exact candidate fingerprint.");
  }

  return {
    decision: blockers.length ? "no-go" : "go",
    blockers,
    metrics: {
      pilot_sessions: sessions.length,
      completion_rate: completionRate,
      recovery_rate: recoveryRate,
      average_trust_score: averageTrust,
      open_p0: issues.filter((issue) => issue.status === "open" && issue.severity === "P0").length,
      open_p1: issues.filter((issue) => issue.status === "open" && issue.severity === "P1").length
    }
  };
}
