# instant-lite-web

Static landing page for instanode.dev — hosted on GitHub Pages.

## Git hooks

`.githooks/pre-push` blocks direct pushes to `master` to keep changes flowing
through PRs. Server-side protection is paywalled on GitHub's Free plan for
private repos, so this hook is the local stand-in. Opt in once after cloning:

```sh
git config core.hooksPath .githooks
```

Emergency bypass: `git push --no-verify`.

## Architecture

```
instanode.dev (GitHub Pages)  ←  Static HTML/CSS/JS
       │
       │  curl commands point to:
       ▼
api.instanode.dev (bare metal / Fly.io)  ←  Go API (instant-lite-api/)
```

The website is purely static. All API calls go to `api.instanode.dev`, which is
served by the `instant-lite-api` backend. This means:

- Website traffic surges never affect API availability
- GitHub Pages CDN handles unlimited page views for free
- The API server only receives actual provisioning requests

## Setup

### 1. Push to GitHub

```bash
cd instant-lite-web
git init
git add .
git commit -m "Initial commit"
git remote add origin git@github.com:your-org/instant-lite-web.git
git push -u origin main
```

### 2. Enable GitHub Pages

1. Go to **Settings → Pages** in the GitHub repo
2. Under **Build and deployment**, select **GitHub Actions**
3. The workflow at `.github/workflows/deploy.yml` handles the rest

### 3. Custom domain

The `CNAME` file points to `instanode.dev`. Configure DNS:

```
Type  Name     Value
A     @        185.199.108.153
A     @        185.199.109.153
A     @        185.199.110.153
A     @        185.199.111.153
AAAA  @        2606:50c0:8000::153
AAAA  @        2606:50c0:8001::153
AAAA  @        2606:50c0:8002::153
AAAA  @        2606:50c0:8003::153
```

GitHub auto-provisions HTTPS via Let's Encrypt.

## Configuring the API URL

The website reads `window.INSTANT_API` at load time. Default: `https://api.instanode.dev`.

For local development, create an `override.js` file (gitignored):

```html
<!-- Add before </body> in index.html -->
<script>window.INSTANT_API = "http://localhost:8080"</script>
```

Or set it in the browser console: `window.INSTANT_API = "http://localhost:8080"`.

## Files

```
instant-lite-web/
├── index.html                  # Landing page (single file, no build step)
├── llms.txt                    # Agent-readable API spec (static copy)
├── 404.html                    # Redirect to / (GitHub Pages SPA fallback)
├── CNAME                       # Custom domain for GitHub Pages
├── .github/workflows/
│   └── deploy.yml              # GitHub Actions → Pages deployment
└── README.md
```

## Local development

```bash
# Any static file server works
python3 -m http.server 3000
# or
npx serve .
```

Open http://localhost:3000. The curl commands will point to `https://api.instanode.dev`
by default. Override with the browser console if testing against a local API.
