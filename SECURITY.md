# Security Policy

## Supported Versions

Only the latest published minor/patch release of `biztalk-migrate` receives
security fixes. Older versions are not patched — upgrade to the latest release
to receive fixes.

| Version        | Supported |
| -------------- | --------- |
| 1.0.x (latest) | Yes       |
| < latest 1.0.x | No        |

## Reporting a Vulnerability

Please report vulnerabilities **privately** — do not open a public GitHub
issue for security problems.

- **Email:** Me@Jonlevesque.com
- Include: a description of the issue, steps to reproduce, the affected
  component (see scope below), and the version you tested against.

### What to expect

- **Acknowledgement** within 3 business days.
- An initial **assessment and severity classification** within 7 days.
- A fix or documented mitigation for confirmed vulnerabilities, targeted
  within 30 days for high/critical issues. You will be kept informed of
  progress and credited in release notes if you wish.
- Please allow a fix to be released before any public disclosure
  (coordinated disclosure).

## Scope

This policy covers the components distributed and operated by this project:

1. **CLI / npm package** (`biztalk-migrate`) — including the MCP server and
   migration runner shipped in the package.
2. **VS Code extension** — the extension bundle built from this repository.
3. **Proxy service** — the hosted API at `api.biztalkmigrate.com` (license
   validation and AI enrichment endpoints).

Out of scope: vulnerabilities in third-party dependencies with no exploitable
path through this tool, issues requiring physical access to a user's machine,
and social engineering.

## Handling of Customer Data

BizTalk artifact parsing runs locally on the consultant's machine. Reports of
any behavior that contradicts the documented data-handling model (customer
artifact content leaving the machine outside the documented enrichment flow)
are treated as high-severity and are explicitly in scope.
