# liteya-workflow

Static mirror of the liteya status dashboard for https://workflow.liteya.ru.
All data (`data.enc`) is AES-256-GCM encrypted on the owner's machine; the key is derived from the login and password in the browser (PBKDF2-SHA256, 600k). Nothing is readable without the password.
