import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

const SLSA_PROVENANCE_V1 = "https://slsa.dev/provenance/v1";
const IN_TOTO_STATEMENT_V1 = "https://in-toto.io/Statement/v1";

function option(name) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`Missing required ${prefix}<value> option.`);
  return value;
}

function exactObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

const metadataPath = path.resolve(option("metadata"));
const outputPath = path.resolve(option("output"));
const publicationKind = option("publication");
if (!["initial", "subsequent"].includes(publicationKind)) {
  throw new Error("Publication kind must be initial or subsequent.");
}

const workspace = process.env.GITHUB_WORKSPACE;
const commit = process.env.GITHUB_SHA;
const tagName = process.env.GITHUB_REF_NAME;
const integrity = process.env.LOCAL_NPM_INTEGRITY;
if (!workspace || !/^[0-9a-f]{40}$/u.test(commit ?? "") || !tagName || !integrity?.startsWith("sha512-")) {
  throw new Error("GitHub source identity and exact npm integrity are required.");
}

const policy = JSON.parse(fs.readFileSync(path.join(workspace, "config/companion-release-policy.json"), "utf8"));
const published = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
const expectedWorkflow = publicationKind === "initial"
  ? policy.publication.expected_initial_provenance_workflow
  : policy.publication.subsequent_workflow_path;
const expectedRef = `refs/tags/${tagName}`;
const expectedSubject = `pkg:npm/${policy.package.name}@${policy.package.version}`;
const [, integrityBase64, extraIntegrityPart] = integrity.split("-");
if (!integrityBase64 || extraIntegrityPart !== undefined) {
  throw new Error("Exact npm integrity must contain one SHA-512 digest.");
}
const expectedSha512 = Buffer.from(integrityBase64, "base64").toString("hex");
if (!/^[0-9a-f]{128}$/u.test(expectedSha512)
    || `sha512-${Buffer.from(expectedSha512, "hex").toString("base64")}` !== integrity) {
  throw new Error("Exact npm integrity is not canonical SHA-512 SRI.");
}

if (published.name !== policy.package.name
    || published.version !== policy.package.version
    || published.dist?.integrity !== integrity
    || published.dist?.attestations?.provenance?.predicateType !== SLSA_PROVENANCE_V1) {
  throw new Error("npm metadata is not bound to the exact package bytes and SLSA predicate.");
}

const attestationUrl = new URL(published.dist.attestations.url);
const registry = new URL(policy.package.registry);
if (attestationUrl.protocol !== "https:"
    || attestationUrl.origin !== registry.origin
    || attestationUrl.username
    || attestationUrl.password
    || attestationUrl.search
    || attestationUrl.hash
    || !attestationUrl.pathname.startsWith("/-/npm/v1/attestations/")) {
  throw new Error("npm attestation URL is outside the exact HTTPS registry boundary.");
}

const response = await globalThis.fetch(attestationUrl, {
  headers: { accept: "application/json" },
  redirect: "error",
  signal: globalThis.AbortSignal.timeout(15_000)
});
if (!response.ok) throw new Error(`npm attestation endpoint returned ${response.status}.`);
const responseType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
if (responseType !== "application/json") throw new Error("npm attestation endpoint did not return JSON.");
const attestationDocument = exactObject(await response.json(), "npm attestation response");
const provenanceAttestations = (attestationDocument.attestations ?? [])
  .filter((attestation) => attestation?.predicateType === SLSA_PROVENANCE_V1);
if (provenanceAttestations.length !== 1) {
  throw new Error("npm attestation response must contain one SLSA provenance statement.");
}

const bundle = exactObject(provenanceAttestations[0].bundle, "SLSA bundle");
const envelope = exactObject(bundle.dsseEnvelope, "SLSA DSSE envelope");
if (envelope.payloadType !== "application/vnd.in-toto+json"
    || typeof envelope.payload !== "string"
    || !Array.isArray(envelope.signatures)
    || envelope.signatures.length === 0) {
  throw new Error("SLSA DSSE envelope is incomplete.");
}
const payloadBytes = Buffer.from(envelope.payload, "base64");
if (!payloadBytes.length
    || payloadBytes.toString("base64").replace(/=+$/u, "") !== envelope.payload.replace(/=+$/u, "")) {
  throw new Error("SLSA DSSE payload is not canonical base64.");
}
const statement = exactObject(JSON.parse(payloadBytes.toString("utf8")), "SLSA statement");
if (statement._type !== IN_TOTO_STATEMENT_V1 || statement.predicateType !== SLSA_PROVENANCE_V1) {
  throw new Error("SLSA payload is not an in-toto v1 provenance statement.");
}

const subjectList = statement.subject ?? [];
if (!Array.isArray(subjectList)) throw new Error("SLSA subject list is invalid.");
const subjects = subjectList.filter((subject) =>
  subject?.name === expectedSubject && subject?.digest?.sha512?.toLowerCase() === expectedSha512
);
if (subjects.length !== 1 || subjectList.length !== 1) {
  throw new Error("SLSA subject is not the exact npm package and SHA-512 digest.");
}

const buildDefinition = exactObject(statement.predicate?.buildDefinition, "SLSA build definition");
const workflow = exactObject(buildDefinition.externalParameters?.workflow, "SLSA workflow source");
if (workflow.repository !== policy.publication.expected_provenance_repository
    || workflow.path !== expectedWorkflow
    || workflow.ref !== expectedRef) {
  throw new Error("SLSA workflow repository, path, or tag is not the reviewed publication source.");
}
const resolvedDependencies = buildDefinition.resolvedDependencies ?? [];
if (!Array.isArray(resolvedDependencies)
    || resolvedDependencies.length !== 1
    || resolvedDependencies[0]?.digest?.gitCommit !== commit) {
  throw new Error("SLSA resolved dependency is not the exact GitHub commit.");
}

const binding = {
  provenance_predicate_type: SLSA_PROVENANCE_V1,
  provenance_subject: expectedSubject,
  provenance_subject_sha512: expectedSha512,
  provenance_repository: workflow.repository,
  provenance_workflow: workflow.path,
  provenance_ref: workflow.ref,
  provenance_resolved_commit: commit
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(binding, null, 2)}\n`);
