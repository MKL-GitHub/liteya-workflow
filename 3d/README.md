# liteya dashboard · 3D (`/3d/`)

Static 3D version of the status dashboard, served from the same GitHub Pages site (https://workflow.liteya.ru/3d/).

- `index.html` loads `/lw.js` (same login gate, AES-256-GCM `data.enc`, key = PBKDF2(login:password)); nothing is visible without the password. `__V__` is replaced with a build stamp on deploy (cache busting).
- `app.js` — panels (HTML via three.js CSS3DRenderer, crisp text), data rendering ported 1:1 from the 2D page (filters, per-project counters, milestone badges from `apps[p].ms[M]`, acceptance placeholders, search), springs for all motion, fps governor.
- `scene.js` — WebGL room: walls/ceiling shaders, mirrored floor (Reflector), holographic sphere with the infinity logo and orbital rings, floor platform and light beams, anime night-city window (`assets/window.jpg`, cropped from the 2D background), sakura petals and dust, bloom.
- `vendor/three` — three.js r170 (MIT), vendored so nothing loads from a CDN.

Fallbacks: no WebGL → panels only (CSS 3D) with a gradient room and the anime picture as a panel; weak devices (≤4 cores / ≤4 GB / mobile) start at the lower quality (no mirror, fewer particles, DPR 1); the fps governor steps down further at runtime; `prefers-reduced-motion` (or `?still`) keeps motion minimal. `?q=low|high|none` forces a level for testing.
Deploy: copy this folder to `3d/` in the pages repo (MKL-GitHub/liteya-workflow); `deploy.yml` copies `3d/` into the site.

Cache stamp: `index.html` and the `scene.js` import in `app.js` carry `?v=__V__`. Before copying to the pages repo, replace it, e.g. `sed -i "s/__V__/$(date +%Y%m%d%H%M)/g" 3d/index.html 3d/app.js`.

Browser checks (not in the repository): Playwright scripts on the box (`/workspace/dash3d/src/*.mjs`: `bars.mjs` compares the 2D and 3D milestone bars, `flicker.mjs` looks for black frames, `blackcheck.mjs` moves the cursor at 1024x838/1280x800/1920x1080 × DPR 1/1.25/1.5/2 and fails on any near-black sampled pixel (`D3D=1` emulates Windows ANGLE, where GLSL `pow` of a negative base is NaN), `shot.mjs` takes screenshots, `btn2d.mjs`/`cmp2d.mjs` check the «3D версия» button and the 2D numbers). They need `playwright-core`, `/usr/bin/google-chrome`, a test `data.enc` (`ROUTE_ENC`) and its test login, and they write to box paths, so they are not self-contained tests.

Shaders: GLSL `pow` is undefined for a negative base (NaN on Windows/ANGLE/Direct3D, then the bloom spreads it into black blocks), so squares use `sq()` from `SAFE_GLSL` and other `pow` bases are clamped; a `SANITIZE` pass before the bloom turns any non-finite value into the room tone. `apps/workflow-liteya-site/dashboard/tests/test_3d_black.py` pins this.
