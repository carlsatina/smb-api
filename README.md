# Backend — Sales & Inventory

Express + Prisma REST API for the Sales & Inventory platform. Multi-tenant, with
role- and plan-based access control. Requires **Node.js >= 22** and **PostgreSQL**.

For the project overview and full-stack setup, see the [root README](../README.md).

## Setup

```bash
npm install
cp .env.example .env     # set DATABASE_URL, token secrets, etc.
npm run db:deploy        # apply migrations
npm run db:seed          # optional: seed data
npm run dev              # tsx watch; PORT from .env (default 3500)
```

## Commands

```bash
npm run dev               # development server (tsx watch)
npm run build             # prisma generate + TypeScript compile
npm run start             # run the compiled build (dist/)

npm run test              # unit tests (excludes integration/)
npm run test:integration  # integration tests (requires a database, run sequentially)
npm run test:watch        # tests in watch mode
npm run test:all          # unit + integration

# run a single test
vitest run tests/auth-service.test.ts
vitest run --config vitest.integration.config.ts tests/integration/auth-flow.test.ts

# database
npm run db:deploy         # apply pending migrations
npm run db:seed           # seed the database
npm run db:seed:admin     # seed the platform super admin (uses SUPER_ADMIN_* env vars)
npm run db:backup         # back up the database
npm run db:restore        # restore the database
```

## Architecture

Each feature lives in `src/modules/<feature>/` with consistent layering:

```
modules/<feature>/
├── <feature>.routes.ts       Express router + middleware
├── <feature>.controller.ts   Request handlers
├── <feature>.service.ts      Business logic
├── <feature>.repository.ts   Prisma data access
└── <feature>.schemas.ts      Zod validation
```

Modules: `auth`, `stores`, `storeMembers`, `products`, `recipes`, `ingredients`,
`inventory`, `sales`, `dailySales`, `purchaseOrders`, `suppliers`, `reports`,
`auditLogs`, `admin`.

### Routing & middleware

Store-scoped routes follow `/api/v1/stores/:storeId/<feature>` and run, in order:

1. `authMiddleware` — validates the JWT, populates `req.user` with `{ sub, email }`.
2. `requireStoreRole([roles])` — checks the user's membership/role in the store.
3. `requirePlanFeature(feature)` — gates premium features by the store owner's subscription.

### Error handling

Throw `AppError` from `src/shared/errors.ts`:

```typescript
throw new AppError('ERROR_CODE', 'User-facing message', statusCode, optionalDetails);
```

## Database

PostgreSQL via Prisma. Schema: `prisma/schema.prisma`.

Key models: `User`, `Store`, `StoreMember`, `Product` (`READY_MADE` / `RECIPE`),
`Ingredient`, `Recipe`, `Sale`, `PurchaseOrder`, `InventoryMovement`.

Key enums: `Role`, `PlanTier`, `ProductType`, `MovementType`, `SaleStatus`,
`PurchaseOrderStatus`.

## Environment variables

See `.env.example` for the full list. Essentials:

| Variable | Description |
| --- | --- |
| `PORT` | API port (default `3500`). |
| `DATABASE_URL` | PostgreSQL connection string. |
| `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET` | JWT signing secrets. |
| `APP_BASE_URL` | Public URL of the frontend. |
| `CORS_ORIGINS` | Comma-separated allowed origins. |

Additional groups in `.env.example` cover token/cookie settings, email (Resend or
SMTP), error reporting (Sentry/GlitchTip), the platform super admin seed, and
data-retention options.
