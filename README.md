# LLM Client Monorepo

This repository contains two Next.js apps:

- `current legacy client` – the original app kept for reference.
- `new-ui-client` – the redesigned client that should be deployed.

## Deploying to Vercel

Vercel should build from the `new-ui-client` subdirectory. There are two ways to ensure this:

1. **Use the included `vercel.json`** (preferred). Simply connect the repo; Vercel will automatically run the build from `new-ui-client` using the Next.js framework.
2. **Or set the Root Directory in the Vercel dashboard** to `new-ui-client` if you prefer per-project settings.

With either approach, keep the framework set to **Next.js**. No alternate framework is required.

### Required commands (already encoded in `vercel.json`)
- Install: `npm install` (runs in `new-ui-client`)
- Build: `npm run build`

### Environment variables
Make sure the Supabase keys, OpenAI key, and any other secrets required by the API routes are configured in the Vercel project settings.
