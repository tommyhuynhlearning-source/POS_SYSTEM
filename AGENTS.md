# POS System — Project Context for Codex

## Product overview

Build a web-based POS and online food-ordering system for restaurants. The target architecture is microservices. Restaurant staff use the POS in-store; customers order through a restaurant-specific link; staff manage the restaurant through a remote dashboard.

The brief says “booking”, but the described menu, cart, total and payment flow sounds like food ordering rather than table reservations. Treat it as food ordering for discussion only; confirm before implementing reservation scheduling.

## Requirements from the owner

### POS

- Main screen has three areas: a left vertical navigation for **Dishes/Menu**, **Settings** and **Storage/Inventory**; a center workspace for the selected area; and a right order panel with selected dishes, quantities and running total.
- The order panel has a **Pay** action that opens a separate checkout/payment page.
- Show dishes currently available at the restaurant.
- The POS must also work on phones: preserve the complete ordering flow, usable touch targets and readable totals; adapt the three-area desktop layout instead of shrinking it onto a narrow screen.

### Customer ordering

- Each restaurant has a shareable restaurant-specific ordering link.
- Customers can browse available dishes, build an order, see the total and proceed to payment.
- Collect the customer's name, address and phone number.
- Delivery versus pickup, fees and address requirements are not yet defined.
- The restaurant-specific ordering link must work well in a mobile browser, since customers may open it from their phones.

### Backend and dashboard

- Store restaurant, menu, inventory/storage, order and receipt data.
- PostgreSQL is required/preferred by the owner.
- An AWS account/console already exists. Its current services and configuration have not been documented here; inspect before proposing or changing infrastructure. Never commit credentials.
- Keep two distinct restaurant interfaces: the owner dashboard manages the restaurant remotely; the POS is for in-store ordering. They share tenant-scoped backend data but use separate page layouts and URLs. No platform-admin interface is required.
- POS layout: a vertical left rail for Food, Settings and Storage; the center shows the selected section; the right side holds the current order and total. Payment opens a separate checkout page.
- Keep both interfaces usable on phones. On POS, the section rail becomes a horizontal row and the cart opens as a drawer without covering checkout controls.
- Show revenue for a selected day. Confirm timezone, currency, taxes, discounts, tips, cancellations/refunds and payment breakdown before fixing the calculation.

## Initial stack proposal for architecture brainstorming

This is a **candidate**, not an approved or already deployed stack. First inspect the repository and AWS account configuration; follow any established choices that already exist.

**Current delivery phase override:** the owner has asked to build frontend/backend first and run on-premises for now, with the same setup portable across multiple machines. Do not deploy to AWS or make AWS a runtime dependency in this phase. Use Docker images and Docker Compose for the web app, backend services and PostgreSQL; keep configuration in environment variables and persistent database storage in a named volume. Cloud migration comes later.

**Implementation status:** Docker Compose is a required delivery interface. Keep services portable and stateless; use environment configuration and named volumes for persistent data. Docker is installed on the current host. Build and browser-check the UI when changing its layout; report which workflows and viewport sizes were exercised.

- **Frontend:** React + TypeScript + Vite for the POS, staff dashboard and restaurant ordering page. These are interactive app screens; Vite keeps the client app straightforward to serve. If public restaurant/menu pages need search-engine indexing or server rendering, compare Next.js before deciding.
- **Mobile:** Make the same web application responsive and usable in mobile browsers first; optionally make it installable as a PWA after confirming the need. This avoids maintaining separate web and native clients for the first release. Do not promise offline POS behavior or assume a PWA can replace native hardware integrations; confirm those needs. If reliable offline operation, receipt-printer/cash-drawer integration or app-store distribution is required, evaluate a native/hybrid mobile client as a separate decision.
- **Multi-restaurant SaaS:** If the product serves many restaurants, use a shared application/service fleet by default rather than provisioning a stack for each shop. Each restaurant gets a public slug/link, and business records are scoped by a trusted `restaurant_id` derived from the resolved slug or authenticated staff membership. Enforce tenant isolation in every API/data access path; authentication alone is not isolation. Consider dedicated infrastructure only for an explicit premium, compliance or noisy-neighbor requirement. ([AWS SaaS Lens](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/preventing-cross-tenant-access.html))
- **Restaurant onboarding/link creation:** Recommended first flow: the owner visits the restaurant portal's registration page and submits restaurant details. The backend creates an owner login and restaurant record immediately, assigns a unique public slug, and shows a shared-domain link such as `https://order.example.com/{slug}` in the restaurant dashboard. No company platform-admin approval step is required. The owner adds dishes and required details, then publishes online ordering. The public frontend resolves the slug and loads only that restaurant's published menu. Require a unique database constraint, handle slug collisions with a suffix, and never treat the public slug as an authorization secret. A manual invite flow can replace self-signup for a private pilot. Custom domains can be a later feature.
- **Management portals/roles and DNS:** The POS company owns one root domain, e.g. `poscompany.com`, and configures shared subdomains such as `app.poscompany.com` and `order.poscompany.com` once in DNS/deployment. Do not provision a new DNS subdomain for every restaurant by default. `app.poscompany.com` is a protected restaurant portal: owners sign in to manage only their own restaurant. There is no platform-admin workflow in this product scope. `order.poscompany.com/{restaurantSlug}` is the public customer ordering site; anyone may open a published restaurant's link to place an order, but the page/API only expose that restaurant's public menu. After staff sign-in, route users by role and enforce tenant scoping on every backend access. Restaurants do not need to own a domain initially; custom restaurant domains can be added later. Both portals can initially use one frontend deployment and the same backend services. Enforce restaurant ownership in every API route; never rely on hiding UI controls as authorization. Split frontend deployments later only if branding, teams, security boundaries or release schedules require it.
- **Backend in this on-prem phase:** separate Express + TypeScript Catalog and Orders APIs using REST/JSON. Keep their service-owned databases and tenant checks. NestJS or OpenAPI generation can be considered later if the team needs them; do not migrate frameworks just for the sake of it.
- **Database:** PostgreSQL on Amazon RDS. Begin with one managed RDS PostgreSQL instance if the account and budget suit it, while giving each service its own database/schema, credentials and migrations. Services must not read/write another service's tables directly. Separate instances can be considered when load, isolation or operational needs justify them.
- **Compute/deploy:** Serve the Vite static frontend through CloudFront + S3. Build backend Docker images into ECR and run services on ECS with Fargate, behind an Application Load Balancer. This avoids operating a Kubernetes cluster for the initial system. Verify the existing AWS region, network, permissions and cost constraints first.
- **Authentication:** Amazon Cognito User Pools for staff sign-in is a candidate. Enforce restaurant membership/roles in the backend; never trust a restaurant ID supplied by the browser alone. Customer checkout can remain guest checkout unless accounts are requested.
- **Async work:** Amazon SQS for post-payment work such as inventory updates and receipt generation, with retries, a dead-letter queue and idempotent consumers. For POS cash, mark an order paid only after the authenticated owner confirms receipt. For online payments, require the provider’s verified server response/webhook; do not mark orders paid based only on a redirect.
- **Receipts/files:** Store receipt and line-item facts in PostgreSQL. Use private S3 only for generated receipt PDFs or uploaded dish images; S3 is file/object storage, not the inventory database.
- **Observability/secrets:** CloudWatch for service logs/metrics and AWS Secrets Manager or an existing approved secret store for credentials. Avoid adding other AWS services until the existing account and needs are understood.
- **Repository:** A pnpm TypeScript monorepo is a reasonable starting point for a small team: shared API types/UI packages where useful, separately built and deployed service applications. Do not create shared domain logic that makes services depend on each other's internals.
- **DevOps/IaC:** Since this repository is on GitHub, use GitHub Actions for CI/CD and AWS CDK in TypeScript for infrastructure as code, unless the existing AWS account already uses another IaC tool. Authenticate Actions to AWS with OIDC and a narrowly scoped IAM role; do not store long-lived AWS access keys in GitHub secrets.
- **Release flow:** On pull requests, run formatting/lint, type checks, focused tests and production builds. On merge to the deployment branch, build immutable Docker images tagged by commit SHA, push them to ECR and deploy to ECS; build the frontend to S3 and invalidate CloudFront. Use separate dev/staging/prod environments, with a manual gate for production. Start with ECS rolling deployments and health checks; enable the ECS deployment circuit breaker/rollback.
- **Database release safety:** Run schema migrations as an explicit deployment step, use backward-compatible expand/contract changes, and avoid coupling an irreversible schema change to a code rollback. Enable RDS backups and periodically verify restore procedures.
- **Operations:** Send service logs/metrics to CloudWatch and alert on failed deployments, unhealthy tasks, API errors and database pressure. Keep dashboards and alerts small and actionable; add a dedicated tracing/monitoring vendor only if CloudWatch is insufficient.

Official references for this candidate: [React app setup](https://react.dev/learn/build-a-react-app-from-scratch), [NestJS microservices](https://docs.nestjs.com/microservices/basics), [ECS/Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-configuration.html), [RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/), [Cognito User Pools](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools.html), [SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/), [S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html), [GitHub Actions OIDC to AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws), [AWS CDK TypeScript](https://docs.aws.amazon.com/cdk/v2/guide/work-with-cdk-typescript.html), [ECS deployment rollback](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html) and [Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/).

**Lambda note:** Lambda is compute, not a restaurant booking URL by itself. A customer link should point to the shared frontend (for example `order.example.com/{restaurantSlug}`); that frontend calls the shared API. API Gateway can route an HTTP route to Lambda. For a future container deployment, keep the ordering API on ECS for a consistent service model; consider Lambda for a concrete short-lived or bursty event-driven workload, not one function per restaurant. If Lambda connects frequently to RDS, evaluate RDS Proxy to pool database connections. ([API Gateway integrations](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations.html), [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html), [Lambda with RDS](https://docs.aws.amazon.com/lambda/latest/dg/services-rds.html))

### Candidate service boundaries

Keep the first design to a few clear ownership areas; refine after confirming what “storage” means.

1. **Restaurant/Catalog service:** restaurant profile/settings, dishes, prices, menu availability and restaurant-specific public slug/link.
2. **Inventory service:** ingredient/item stock and stock movements, if “storage” means inventory. If it only means whether a dish is available, keep availability in Catalog at first.
3. **Ordering service:** order/cart checkout state, customer contact/delivery details, order totals/status, and receipt records. Keep payment-provider integration inside this service initially; extract a Payment service only if provider workflows or scale warrant it.
4. **Identity:** Cognito handles authentication; the app owns restaurant membership and authorization rules.

For a future cloud deployment, each business service can run as its own container/service, with its own API, deployment, database/schema, credentials and migrations. Define boundaries around business capabilities so services can change and deploy independently; avoid creating a service for every table or CRUD endpoint. ([AWS guidance on bounded contexts](https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-decomposing-monoliths/decompose-subdomain.html))

The browser calls the ALB/API entry point, which routes to the relevant service. Use synchronous REST calls where checkout needs an immediate answer, such as asking Catalog for current prices and Inventory for availability/reservation. After payment is verified, publish an `OrderPaid` event through SQS for work such as finalizing inventory and generating a receipt. Make event consumers idempotent and retryable; use a dead-letter queue. Do not make a single database transaction span multiple services. If reliable event publication becomes necessary, use a transactional outbox owned by the service that changes the order state. AWS recommends queues when services can be decoupled asynchronously. ([AWS SQS guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-integrating-microservices/sqs.html))

Keep one RDS PostgreSQL cluster initially if practical, but maintain service-owned schemas/databases and permissions; do not share tables or run cross-service joins. Separate physical clusters only when scale, isolation, or operations justify them. Calculate daily revenue from paid orders using the restaurant's local date range, once those accounting rules are agreed.

Do not add Kafka, Kubernetes, a separate analytics service, an API gateway, Redis, or a reporting warehouse by default. Introduce them only for a concrete requirement that the simpler candidate cannot meet.

## Open decisions

1. Is “booking” food ordering only, or are table reservations also needed?
2. Delivery, pickup, or both? What address fields, service areas and fees apply?
3. POS MVP accepts cash; the signed-in owner confirms cash was received. Which provider should online checkout use?
4. One restaurant initially or multiple restaurants/tenants? Who creates restaurant accounts and staff users?
5. Does “storage” mean ingredients, dish stock/availability, AWS file storage, or more than one of these?
6. What should receipts contain, and should they be printable, downloadable, emailed or sent by SMS?
7. Define revenue: restaurant timezone, currency, taxes, discounts, tips, cancelled/refunded orders and gross versus net.
8. Which AWS region/services/network already exist, and what are the budget and expected order volume?
9. Does the public ordering link need SEO/search indexing, or is a client-rendered app sufficient?
10. Does “mobile support” mean responsive mobile web/PWA, or is a native Android/iOS app required? Must POS workflows work offline or connect to printers, barcode scanners or cash drawers?
11. Should restaurant accounts support multiple staff users, or is one owner login sufficient for the first version?
12. Which payment provider should confirm online payments so online sales can count as paid revenue?

Do not block unrelated discovery on these questions. If an answer is needed before a design choice, state the assumption and ask the owner rather than silently making it permanent.

## Skill context

For coding, read `.agents/skills/ponytail/SKILL.md`. Apply its default **full** level: make the smallest complete change, use existing project patterns, avoid unrequested abstractions/dependencies, and preserve validation, data safety, security, error handling and accessibility. Non-trivial money, parsing, branching or security logic needs a focused check consistent with the project.

For POS, checkout, menu, customer ordering and dashboard UI, read `.agents/skills/design-taste-frontend/SKILL.md`. These are app screens, so also read `.agents/skills/design-taste-frontend/references/app-screens.md` and use its app-screen workflow rather than the marketing-page workflow. Make totals reconcile, use truthful sample data, show honest zero/loading/empty/error states, and keep all required workflows usable at desktop, tablet and phone widths. On phones, use touch-sized controls, reflow navigation and the cart/order panel into an intentional mobile flow, and never require horizontal page scrolling. Avoid generic dashboard templates and decoration that gets in the way of operations.

Do not invent restaurant branding, menu items, reviews or business metrics as facts. If sample data is needed, label it as sample data. Keep operational screens readable, accessible and quick to use.

## Repository status

When this file was created, the repository had no application source, package manifest or architecture documentation. Re-check before implementation; this is a snapshot, not proof that the codebase or AWS environment is still empty.

## Current implementation note

This repository now has an on-premises Docker Compose starter with a Vite/React frontend, Catalog API and Orders API and PostgreSQL with separate service databases. Read `README.md` before developing further. The owner dashboard and POS are separate interfaces at `/dashboard` and `/pos`. The POS uses the Food/Settings/Storage rail, center workspace and right-side order cart; payment opens a separate checkout screen. POS checkout shows Cash, Card, QR and Gift. Only Cash can be completed; it records as paid after the signed-in owner confirms receipt. Card, QR and Gift remain unavailable until their terminal/provider or gift-card redemption is configured. Online checkout remains pending until a payment provider and verified confirmation/webhook flow are selected. Dish availability is not ingredient inventory. Docker Compose is the portable delivery interface for on-premises operation.

The first implementation uses small Express + TypeScript APIs (instead of the earlier NestJS candidate) to keep the initial on-prem stack lean. Continue with service-owned databases and REST boundaries unless requirements justify a framework change.
