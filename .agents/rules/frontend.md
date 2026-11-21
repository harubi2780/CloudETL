---
trigger: model_decision
description: "Apply when creating, reviewing, or changing React UI, components, client-side state, forms, routing, or frontend API integration."
---
- Follow the existing React version, build tooling, component patterns, styling, and state-management conventions.
- Keep API access separate from presentation logic where practical; use reusable components without speculative abstraction.
- Represent ETL steps as structured configuration and submit declarative JSON matching the backend contract. Never send executable code.
- Provide clear validation feedback and loading, empty, success, and failure states.
- Frontend validation improves usability only; the backend remains authoritative for validation and authorization.
- Never put secrets, privileged credentials, or storage/database credentials in browser code.
- Keep the UI clear and restrained; avoid excessive decorative cards, rounded containers, and unnecessary dependencies.
- Add/update relevant component, interaction, and API-contract tests using existing project tooling.
