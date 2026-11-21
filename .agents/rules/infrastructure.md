---
trigger: model_decision
description: "Apply when changing Docker, Docker Compose, environment configuration, CI/CD, AWS resources, networking, deployment, storage infrastructure, or observability."
---
- Inspect current infrastructure and deployment assumptions before proposing changes. Do not assume a specific AWS service or tenancy model.
- Keep local and production configuration separate. Use Docker Compose for local development where appropriate and preserve persistent database volumes.
- Do not expose PostgreSQL publicly by default. Prefer private networking for internal services.
- For AWS, encrypted storage and transport, managed secrets, and appropriate logging/monitoring.
- Keep infrastructure proportionate to a university project; explain recurring cost, operational burden, and alternatives.
- Never apply infrastructure changes, deploy, alter IAM/network exposure, delete resources/volumes, or incur external costs without explicit approval.
- Never commit real secrets or production `.env` files. Provide safe examples using placeholders.
- Verify configuration with available validation/build commands; do not claim deployment success without executing and checking it.
