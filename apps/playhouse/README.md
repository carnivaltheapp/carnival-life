# Carnival PlayHouse

PlayHouse is the Carnival Life application for creating, organizing, viewing, and managing Plays.

This directory is a Next.js App Router application and the configured root for the `carnival-playhouse` Vercel project. It uses Supabase SSR cookie sessions and Google OAuth with PKCE. Play storage is selected server-side with `PLAYHOUSE_DATA_SOURCE`; Mongo is the temporary default, while Supabase remains responsible for authentication, account data, and Google/contact infrastructure.

Local development runs on [http://localhost:3002](http://localhost:3002). Copy `.env.example` to `.env.local` and fill in the hosted Supabase URL and publishable key before testing sign-in.

See the [repository README](../../README.md) for installation, development, checks, and deployment instructions.
