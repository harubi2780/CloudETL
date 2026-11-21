---
trigger: model_decision
description: "Apply when handling authentication, authorization, user/tenant isolation, uploads, file storage, secrets, external connections, pipeline JSON, or sensitive data."
---
- Treat files, metadata, JSON pipeline definitions, connection details, and all client input as untrusted.
- Enforce server-side authentication and object-level authorization on every user-owned dataset, pipeline, job, export, and connection. Never trust client-supplied ownership identifiers.
- Validate uploads using size limits and content-aware checks; do not trust extensions or MIME headers alone. Validate encoding, schema, and transformation parameters as appropriate.
- Treat pipeline JSON as a validated declarative schema, never as code to evaluate or execute.
- Keep file bytes in controlled storage and credentials outside the browser. Use least privilege and secure transport/storage.
- Do not log raw data, passwords, tokens, credentials, or private connection strings. Avoid leaking internal errors.
- Consider path traversal, malicious files, resource exhaustion, cross-tenant access, injection, unsafe exports, retries, and temporary-file cleanup where relevant.
- Add tests for unauthorized and cross-user access, malformed input, limits, and failure handling.
- Escalate any security-sensitive policy, IAM, secret, or network change for explicit approval.
