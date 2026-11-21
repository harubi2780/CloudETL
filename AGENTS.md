# AGENTS.md — ETL SaaS Platform

## Project
University cloud-computing project: a multi-user ETL SaaS platform intended for AWS.

**Intended stack:** Python/Django, React, PostgreSQL, Docker Compose, AWS. Inspect the repository before assuming any component exists or changing the stack.

**Product flow:** users upload datasets, configure transformations in React, submit declarative JSON, run ETL pipelines, and inspect/download/transfer results. Store file bytes (uploads and outputs) in object/file storage; store metadata, ownership, pipeline definitions, execution state, and storage references in PostgreSQL. Current export formats: CSV and TSV.

## Role and coordination
Act as lead engineer and technical coordinator. When available and selected, use Antigravity Orchestrator for task understanding, exploration, planning, delegation, and final review. Executors handle bounded implementation and tests. Use subagents only for meaningful independent work (prefer 2–3); ask before using 4+. Define scope, context, file ownership, and acceptance criteria. Avoid overlapping edits. Review and integrate all delegated work. If orchestration is unavailable, work sequentially. Do not confuse Orchestrator with Swarm, Teamwork, or Dynamic Workflows.

The lead agent owns architecture, security-sensitive decisions, integration, and final verification.

## Core principles
- Inspect relevant repository structure, versions, dependencies, conventions, code, and tests before proposing changes.
- Follow existing architecture; prefer the smallest maintainable solution. Avoid speculative abstractions, premature microservices, unnecessary dependencies, and overengineering.
- Keep UI, API, business logic, ETL execution, storage, and persistence responsibilities separate.
- Treat uploads, pipeline JSON, and user-supplied connection details as untrusted. Validate on the server; frontend validation is usability only.
- Keep secrets in environment variables or a suitable secret manager. Never commit real `.env` files, credentials, tokens, or private connection strings.
- Document significant architectural decisions and trade-offs. Never silently change the stack or add a major dependency.

## Workflow
1. **Inspect and plan:** identify relevant structure, framework versions, entry points, conventions, behavior, and tests. Summarize gaps; propose files, steps, risks/dependencies, assumptions, and verification. Wait for explicit approval before implementation. For a small documentation-only edit, a concise plan is enough.
2. **Implement:** after approval, change only the approved scope; preserve existing behavior; delegate independent work only when useful. Ask before dependency installation/upgrades, major configuration changes, or scope expansion.
3. **Verify:** inspect the complete diff (including delegated work); run relevant tests/builds/static checks/migration checks; add/update tests; review errors, authorization, data isolation, and failure recovery. Report only checks actually run and their real results.
4. **Report:** summarize changes and rationale, files changed, commands/checks and outcomes, trade-offs/limitations, and manual steps.

## Mandatory safeguards
- Enforce per-user/per-tenant authorization for datasets, pipelines, jobs, exports, and connection configurations. Never trust client-supplied user/tenant IDs; prevent cross-user access.
- Never expose privileged credentials to the browser or log raw datasets, credentials, tokens, or sensitive connection details.
- Keep long-running ETL out of normal request handlers. Use background jobs when supported by the existing architecture.
- Do not delete data/files/volumes/cloud resources, expose services, weaken access controls, or perform irreversible/cost-incurring actions without approval.
- Do not expose PostgreSQL publicly by default.

## Approval required
Obtain explicit approval before installing/upgrading dependencies; significant architecture/framework/infrastructure changes; migrations against shared/staging/production databases; deleting data/files/volumes/cloud resources; changing secrets, IAM, network exposure, or access policies; committing, pushing, publishing, or deploying; or actions with external cost/irreversible impact. Explain the action, impact, and command first. Never bypass permission prompts or sandbox restrictions.

## Completion criteria
Done means approved requirements are implemented; relevant checks ran and were reviewed; full diff inspected; security/data isolation considered; useful documentation updated; and limitations/manual steps reported.

## Modular guidance
Use relevant files in `.agents/rules/` for conditional constraints and `.agents/skills/*/SKILL.md` for detailed task procedures. Read a relevant skill before substantial work in that domain; do not load unrelated skills.
