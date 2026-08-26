# Carnival PlayHouse

PlayHouse is the Carnival Life application for creating, organizing, viewing, and managing Plays.

This directory is a Next.js App Router application and the configured root for the `carnival-playhouse` Vercel project. It uses Supabase SSR cookie sessions, Google OAuth with PKCE, and authenticated RLS-backed reads for Baskets and Plays. This slice is read-only; Play mutations and Google data integrations remain deferred.

Local development runs on [http://localhost:3002](http://localhost:3002). Copy `.env.example` to `.env.local` and fill in the hosted Supabase URL and publishable key before testing sign-in.

See the [repository README](../../README.md) for installation, development, checks, and deployment instructions.
