<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

### Project overview
Cedar Hack is a single Next.js 16 app (not a monorepo). It uses npm as its package manager (`package-lock.json`).

### Running the app
- `npm run dev` — starts the dev server on port 3000.
- `npm run build` — production build.
- `npm run lint` — runs ESLint. The codebase has pre-existing lint warnings/errors.

### Environment variables
A `.env.local` file is required with the following keys:
| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes (placeholder OK for dev) | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Yes (placeholder OK for dev) | Supabase anon key |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | For map rendering | Mapbox GL JS token |
| `CLAUDE_VISION` | Optional | Anthropic API key for AI bid population |

Placeholder values allow the app to start and render pages, but Supabase auth and Mapbox map tiles won't function without real credentials.

### MCP and agent skills
- Supabase MCP is configured in `.cursor/mcp.json` (project ref `eytrzccxbkpfltchdxvs`).
- Supabase agent skills are installed in `.agents/skills/` — use them for Postgres and Supabase best practices.

### Key caveats
- The middleware uses `supabaseUrl!` / `supabaseKey!` (non-null assertions). The app starts fine with placeholder values but real Supabase calls will fail.
- Next.js 16 emits a deprecation warning: `"middleware" file convention is deprecated. Please use "proxy" instead.` This is benign for now.
- Data persistence is via browser `localStorage` (Phase 1); Supabase is wired only for auth.
- External geospatial APIs (USGS, USDA, STAC) are public and keyless; they are called server-side from API routes and degrade gracefully if unreachable.
