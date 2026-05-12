# Clairtus Admin Panel

Next.js admin interface for Clairtus operations workflows.

## Setup

1. Copy `.env.example` to `.env.local`.
2. Fill:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `ADMIN_EMAIL_ALLOWLIST` (comma-separated admin emails)

## Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Implemented in Phase 6 Task 26

- Supabase SSR client setup for browser, server, and middleware.
- Login/logout using Supabase Auth.
- Protected-route middleware for authenticated users.
- Admin-only route protection using `ADMIN_EMAIL_ALLOWLIST`.
- Admin user management page at `/admin/users` with suspend/unsuspend controls.
