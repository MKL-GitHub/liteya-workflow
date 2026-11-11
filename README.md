# liteya-workflow

Static mirror of the liteya status dashboard for https://workflow.liteya.ru.
All data (`data.enc`) is AES-256-GCM encrypted on the owner's machine; the key is derived from the login and password in the browser (PBKDF2-SHA256, 600k). Nothing is readable without the password.

`lw.js` only maps `/api/state` to `data.enc`; the login and decrypt are `/assets/crypto_gate.js`, the shared gate from `packages/crypto_gate/crypto_gate.js` in MKL-Liteya/liteya. `pages_push.py` uploads it to the release `data` and `deploy.yml` puts it into `/assets/`.

`3d/` is the 3D version of the same dashboard (https://workflow.liteya.ru/3d/): three.js vendored locally, same login and the same encrypted `data.enc`.
