# Changelog

All notable changes to `biztalk-migrate` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note on completeness:** during the early, fast-iteration phase of this
> project, many patch versions were published to npm without an individual
> commit or tag per version (several versions sometimes shipped from a single
> commit). This changelog is reconstructed from the git history: the latest
> release is documented in detail, and earlier releases are summarized as
> milestone groups. Where a version number is not listed individually, its
> changes are covered by the surrounding milestone entry.

## [1.0.70] - 2026-08-11

The August 2026 pre-diligence audit release. Six audit workstreams (generator
contract, test integrity, mappings, infrastructure, build/packaging, docs)
merged into a single release.

### Fixed
- **Stage 1 → Stage 3 generator contract**: send steps now honor their
  declared `actionType`/`connector`; trigger recurrence settings are carried
  through; `Terminate` steps generate real Terminate actions; retry policy is
  applied from intent; Scope Catch handlers populate `handlesErrorFrom` and
  loops populate `loopConfig`; dangling `handlesErrorFrom` references are
  dropped and `defaultSteps` are traversed in the package builder.
- **Parser**: `BodyShape` maps to `GroupShape`, and unknown ODX shapes are no
  longer silently collapsed to `CommentShape`.
- **MCP server**: all 8 MCP resources serve real content from any install
  location (previously path-dependent).
- **VS Code extension**: `src/vscode` included in compilation with all
  surfaced type errors fixed; separate extension manifest and esbuild CJS
  bundle; npm pack guards against iCloud duplicate files.
- **Infrastructure output**: `FlowState=Disabled` is set at deploy time in ARM
  `appSettings` (workflows no longer fire immediately on deploy);
  `FUNCTIONS_WORKER_RUNTIME` unified to `dotnet` everywhere; TLS settings made
  consistent across generated infra.

### Added
- **Canonical connector catalog**: the adapter → connector mapping tables were
  reconciled into a single canonical catalog (with 34 new unit tests),
  including Oracle, RabbitMQ, and IBM mappings and an Integration Account
  correction.
- **SBMP retirement advisory**: new gap rule for the retired Service Bus SBMP
  protocol, plus updated gap text for BRE, Oracle, and newer connectors.
- **Trial rate limiting**: per-IP daily rate limit on `POST /v1/license/trial`
  in the proxy service.
- ESLint 9 flat config, test coverage provider, and a CI lint step.

### Changed
- **Docs/positioning corrected for accuracy**: BizTalk lifecycle dates,
  privacy/data-handling claims, and template count now match reality.
- Quality scorer penalizes `TODO: implement this action` placeholder stubs;
  stale regression baseline entries corrected to measured values; soft skip
  guards in tests replaced with hard failures.

## [1.0.65] – [1.0.69] - 2026-03-23

Workspace-consistency fixes from a WinMerge review of generated output against
a known-good Logic Apps Standard reference project.

### Fixed
- Reverted generated `.csproj` to the simple SDK format matching the working
  reference project.
- `ProjectDirectoryPath` is set at generation time; the fix-up task moved from
  `tasks.json` (which triggered a VS Code popup) into a `.ps1` script and then
  into the `.code-workspace` file.

## [1.0.37] – [1.0.64] - 2026-03 (summarized)

Iterative output-quality releases driven by real production migrations.
Highlights reconstructed from commit history:

### Added
- Receiver-workflow architecture (adapter trigger + pipeline + call-orch);
  one workflow generated per `.odx` file.
- `Infra/` folder with Bicep and Terraform templates alongside ARM (1.0.45).
- Per-orchestration and per-workflow flow diagrams; SVG and nested accordion
  diagrams in the HTML report.

### Fixed
- Output restructured to match the canonical Logic Apps Standard workspace
  layout (1.0.40); C# Functions project aligned with the Microsoft Empty
  sample; local code function workspace compatibility.
- Variable initialization ordering, duplicate action names, scope
  `retryPolicy`, `Terminate` runAfter, Until expressions as WDL inline
  strings.
- Quality scorer penalizes gaps and unimplemented stubs (1.0.52).

## [1.0.36] - 2026-03-08

### Added
- **Pipeline-as-workflow architecture**: each BizTalk pipeline (`.btp`)
  generates a reusable Logic Apps workflow, with sequential `runAfter`
  chaining in `buildActions` (1.0.35).

## [1.0.14] – [1.0.35] - 2026-03 (summarized)

### Added
- Estate-level reporting and MSI input mode (`--from-msi`) (1.0.21).
- HTML migration report generated alongside Markdown, then redesigned with
  score ring and collapsible sections (1.0.22).
- C# expression translator with `InvokeFunction` fallback for helper calls
  (1.0.17).
- Custom functoid and community pipeline component gap detection (1.0.25);
  mainframe/SWIFT gap coverage (1.0.24).
- Mapping patterns EMAP-01..06 from published Data Mapper guidance (1.0.14).

### Changed
- Honest quality scores: untranslated C# and tautology conditions are
  penalized (1.0.16); public-facing copy audited for accuracy (1.0.23).

## [1.0.11] – [1.0.13] - 2026-02-28 (summarized)

Deployment-correctness fixes derived from a systematic crawl of community
Logic Apps research (~1,357 posts).

### Fixed
- `InitializeVariable` hoisted above `Scope_Main` (deployment-breaking
  otherwise); child workflows always get a `Response` action; variable and
  workflow name sanitization (80-char action limit, forbidden characters,
  43-char Logic App name limit in ARM); `Terminate_On_Error` runs on
  `SKIPPED` as well as `FAILED`/`TIMEDOUT`.
- FTP/SFTP trigger workflows append an explicit `deleteFile` action (BizTalk
  auto-delete parity); WCF-SQL `[dbo].[sp]` translated to
  `TypedProcedure/dbo/sp`; SAP `systemNumber` emitted as ARM `string`;
  Service Bus entity name sanitization; worker runtime `dotnet-isolated` for
  local code functions.

## [1.0.8] – [1.0.10] - 2026-02-26

Fixes from an external expert review of generated output (first structured
third-party review of the tool).

### Fixed
- `npm test` script, CLI crash ("stepIds is not iterable"), duplicate
  workflows, empty `SetVariable` values, empty `connections.json`, XSD
  schemas not copied to output.
- `TODO_CLAUDE_INVERT` markers resolved client-side for Until loops; Switch
  case expressions extracted from ODX; If-action expressions built from real
  XLANG/s conditions instead of tautologies.
- Error scope always emits `Terminate_On_Error`; HTTP actions get a default
  retry policy; descriptive trigger names.

### Added
- Generated VS Code workspace (`.code-workspace`, `.vscode/` settings) and
  `.cs` local code function stubs with `[WorkflowActionTrigger]`.
- Quality scorer penalties for `TODO_CLAUDE` markers and empty SetVariable
  actions; "Actionable Fix List" in the migration report.

## [1.0.1] – [1.0.7] - 2026-02-24 (summarized)

First public releases on npm.

### Added
- Three-stage migration pipeline (UNDERSTAND → DOCUMENT → BUILD) exposed as
  CLI, MCP server, and GitHub Action.
- Cloudflare Worker proxy holding all proprietary migration domain knowledge
  (zero IP in the shipped client); license key validation; landing page with
  trial/waitlist flow.

### Fixed
- npm package runtime issues: bin path normalization, ESM import paths,
  UTF-16 BTM parsing, ODX parser crash, recursive directory scan, Bearer
  token on `/v1/validate`.

[1.0.70]: https://github.com/JonJLevesque/BTtoLA/compare/v1.0.1...v1.0.70
[1.0.1]: https://github.com/JonJLevesque/BTtoLA/releases/tag/v1.0.1
