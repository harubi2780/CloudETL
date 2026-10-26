## 1. Project Context

- You are the lead developer. Use a planner–executor workflow.
- we are making a ETL system that will be deploy on the cloud and be provide as a SaaS application, the technology we will be using is django for backend, react for frontend, postgres database and docker

### Technology Stack
- Backend: Python and Django
- Frontend: React
- Database: PostgreSQL
- Containerization: Docker and Docker Compose
- Deployment target: AWS

Users should be able to upload datasets, configure transformation steps through the frontend, execute ETL pipelines, and access the processed results.

The frontend should send transformation configurations to the backend as structured JSON.

user uploaded file is store in an storage and database will store the metadata and reference to that file.

data after being 

## 2. Development Principles

- Inspect the existing codebase before making changes.
- Follow the existing architecture and conventions unless there is a clear reason to change them.
- Prefer simple, maintainable solutions over unnecessary complexity.
- Keep frontend, backend, and database responsibilities separate.
- Keep credentials and secrets in environment variables.
- Never commit `.env` files containing secrets.
- Validate uploaded files and transformation configurations on the backend.
- Do not trust client-provided data without server-side validation.
- Document significant architectural decisions.

## 3. Required Workflow

### Phase 1: Inspect and Plan
- Identify the frameworks, directory structure, and existing implementation.
- Understand the relevant code before proposing changes.
- List the intended changes and files affected.
- Identify risks, dependencies, and tests.
- Do not edit files until I approve the plan.

### Phase 2: Implement
- After approval, implement the agreed plan.
- Delegate small, independent coding tasks to the configured `implementer` subagent when appropriate.
- Explicitly invoke the subagent; do not merely describe a hypothetical delegation.
- Keep delegated tasks narrowly scoped with clear acceptance criteria.
- Do not delegate security-sensitive decisions without review.
- Ask before installing dependencies or making significant configuration changes.

### Phase 3: Verify and Review
- Inspect all modified files and review the actual diff.
- Run relevant tests, linting, and validation where available.
- Never claim tests passed unless they were executed successfully.
- Fix identified problems before reporting completion.
- Ask for approval before destructive or externally consequential actions.

### Phase 4: Report
Summarize:
- Files created or modified.
- Important implementation decisions.
- Tests executed and their results.
- Remaining issues and manual steps.

## 4. Backend Rules

- Follow Django conventions and keep business logic organized.
- follow ORM approach.
- Keep secrets and environment-specific settings out of source code.
- Validate request payloads and transformation configurations.
- Use appropriate Django models, migrations, and database constraints.
- Handle exceptions and return consistent API responses.
- Avoid blocking web requests with long-running ETL jobs when a background worker is appropriate.

## 5. Frontend Rules

- Use reusable React components, keep the ui clean simple, no over using round border.
- Keep API communication separate from presentation components where appropriate.
- Validate user input and provide useful error messages.
- Represent transformation pipelines as a structured form and return as a json.
- Handle loading, success, and failure states.
- Do not expose backend credentials or database connection strings to the browser.

## 6. Database and Docker Rules

- Use PostgreSQL as the relational database.
- Store database credentials in environment variables.
- Use Docker Compose to coordinate local development services.
- Use persistent volumes for database data.
- Never delete database volumes or run destructive migrations without explicit approval.
- Keep development and production configurations appropriately separated.
- Do not expose PostgreSQL publicly by default.

## 7. Approval and Safety

- Begin with planning and wait for approval before implementation.
- Request approval before installing dependencies, executing migrations, deleting data, changing secrets, committing, pushing, or deploying.
- Explain commands with significant side effects before requesting approval.
- Do not bypass sandbox restrictions or permission prompts.
- Do not claim deployment succeeded unless it was actually verified.

## 9. Definition of Done

A task is complete when:
- The requested changes are implemented.
- Relevant tests and checks have been run.
- The changes have been reviewed.
- Documentation is updated when needed.
- Remaining limitations are clearly reported.