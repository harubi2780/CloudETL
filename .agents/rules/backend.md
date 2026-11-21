---
trigger: model_decision
description: "Apply when creating, reviewing, or changing Django backend code, API endpoints, serializers, services, authentication, authorization, or backend tests."
---
- Follow the repository's Django version, API framework, app layout, naming, and error-response conventions.
- Keep views/controllers thin. Put domain behavior in services/domain modules where appropriate; use serializers or equivalent schemas at API boundaries.
- Use Django ORM, constraints, and transactions for persistence and related state changes.
- Authenticate requests and enforce object-level authorization for every user-owned resource. Derive ownership from the authenticated principal, never a client-supplied owner/tenant ID.
- Validate types, ranges, file metadata, and transformation configuration server-side. Return consistent errors without leaking internals.
- Keep long-running ETL out of request/response handlers; use the project's background-job architecture if present.
- Add/update focused tests for success, invalid input, unauthorized access, cross-user access, and failure paths.
- Do not introduce a new API framework, job queue, or major dependency without approval.
