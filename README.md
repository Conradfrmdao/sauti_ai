# SAUTI1 AI

SAUTI1 AI is a citizen-to-institution reporting platform built for Uganda. Citizens describe an issue naturally by text or voice, the assistant gathers only the facts needed to act, routes the report to the responsible institution, and keeps the citizen informed through a trackable ticket.

## What it does

- Guided text and live voice reporting
- Structured report extraction with citizen corrections
- Risk-aware follow-up questions and emergency guidance
- Evidence uploads with private attachment handling
- Database-backed routing across verified institutions and services
- Citizen confirmation before a report is submitted
- Ticket tracking, notifications, and institution acknowledgements
- Separate citizen, institution, and platform-admin workspaces
- Responsive desktop shell and mobile-first bottom navigation

## Stack

- Next.js 16 App Router and React 19
- TypeScript and Tailwind CSS
- Supabase Auth, Postgres, Row Level Security, and Storage
- Google Gemini Interactions API for report understanding
- Gemini Live API for real-time voice conversations
- Lucide icons

## How reporting works

1. A citizen signs in and starts a text or voice conversation.
2. SAUTI1 builds a semantic case state from the conversation, including safety, routing, evidence, and blocking facts.
3. The assistant asks the next relevant question instead of following a rigid form order.
4. Routing is checked against the institution and service catalogue in Supabase.
5. The citizen reviews and confirms the report.
6. SAUTI1 creates a ticket for the matched institution and exposes status updates to the citizen.

Gemini interactions are created with `store: false`. The application keeps its own auditable conversation and report state in Supabase and does not rely on provider-side conversation storage.

## Local setup

Prerequisites:

- Node.js 20.9 or newer
- A Supabase project
- A Google AI Studio API key with access to the configured Gemini models

Install dependencies:

```bash
npm install
```

Copy `.env.example` to `.env.local` and set these values:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
GEMINI_MODEL=gemini-3.7-flash
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
GEMINI_THINKING_LEVEL=low
GEMINI_TURN_TIMEOUT_MS=15000
```

Never expose `GEMINI_API_KEY` in browser code or prefix it with `NEXT_PUBLIC_`.

## Database setup

Run every SQL file in `supabase/migrations` in numeric order. The migrations create the core schema, security policies, institution catalogue, ticket workflow, private evidence storage, location intake, risk isolation, and voice cancellation lifecycle.

Citizen profiles are created by the `on_auth_user_created` trigger. Institution users also require an active row in `institution_members`.

Start the development server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Verification

Run the deterministic routing and conversation suite:

```bash
npm run test:ai
```

Run live Gemini scenarios with synthetic fixtures only:

```bash
npm run test:ai:live
```

Run the paced `low` versus `medium` thinking-level benchmark:

```bash
npm run test:ai:benchmark
```

The live commands use API quota and must never be run with real citizen reports, real attachments, or production identifiers.

Build the production application:

```bash
npm run build
```

## Deploy to Vercel

1. Import this repository into Vercel.
2. Add all variables from `.env.example` in the Vercel project settings.
3. Set the production URL as an allowed site URL and redirect URL in Supabase Auth.
4. Deploy from the `main` branch or run `vercel --prod` from the project directory.

The repository intentionally ignores `.env.local`, `.vercel`, dependencies, and build output so credentials and machine-specific state are not published.

## Security model

- Row Level Security limits citizens to their own conversations, reports, evidence, tickets, and notifications.
- Institution members can access only tickets routed to their institution.
- Evidence is stored privately and accessed through authorized application flows.
- Submitted voice reports cannot be deleted through the cancellation function.
- AI fallback behavior remains available when Gemini times out or is unavailable.

## Project structure

```text
app/                  Next.js routes, workspaces, and API handlers
components/           Citizen shell, text chat, voice UI, and shared controls
lib/sauti1/           Report intelligence and location resolution
lib/supabase/         Browser, server, and proxy Supabase clients
supabase/migrations/  Ordered database schema and security migrations
tests/                Deterministic, live-scenario, and benchmark suites
```
