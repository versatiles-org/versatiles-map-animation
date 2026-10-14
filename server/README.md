# Render server

A small server that renders videos for a handful of users: it serves the
editor, takes render jobs from it (or from a pasted share link), renders them
one at a time with the [offline renderer](../render/README.md), and keeps the
videos for download for four weeks.

- **Login** with a users file on the server; each user sees only their own renders.
- **Queue**: one render at a time, the oldest first; queued and running renders can be cancelled.
- **Progress** while rendering: phase, frames, time left.
- **Preview**: a small looping video of every finished render, newest first, and the video to download.
- **In the editor**: logged in, **Export video…** offers **Render on this server** next to the `docker run` command.
- **HTTPS**, if the server has a domain name: certificates from Let's Encrypt, fetched and renewed by the server itself.

No dependencies beyond Node.js 24 and what the renderer needs; no database
(every job is a folder with a `job.json`), no proxy.

## Run it

The server is a variant of the renderer image, tagged `-server`:

```sh
docker run -d --name map-animator --restart unless-stopped \
  -p 8080:8080 -v /srv/map-animator:/data \
  ghcr.io/versatiles-org/versatiles-map-animator:latest-server
```

Then add a user (asks for the password twice) and open `http://<server-ip>:8080/`:

```sh
docker exec -it map-animator node /app/server/passwd.mjs add alice
```

Build the image yourself with `npm run docker:build:server`.

### With a domain name: HTTPS

When a DNS name points to the server, give it as `DOMAIN` and publish
ports 80 and 443 instead of 8080:

```sh
docker run -d --name map-animator --restart unless-stopped \
  -p 80:80 -p 443:443 -v /srv/map-animator:/data \
  -e DOMAIN=maps.example.org \
  ghcr.io/versatiles-org/versatiles-map-animator:latest-server
```

On its first start the server gets a certificate from Let's Encrypt, which
checks the domain by asking for a file on port 80 — so port 80 has to be
reachable from the internet. After a few seconds the server is at
`https://maps.example.org/`; port 80 sends everyone there. The server
checks the certificate twice a day and renews it when a third of its
lifetime is left, without a restart. If getting one fails, the log says
why, and it tries again an hour later; until it has one, port 80 answers
with a note to wait.

`DOMAIN` takes several names, separated by commas (`maps.example.org,www.maps.example.org`);
the certificate covers all of them. To try it out first, set
`ACME_DIRECTORY=https://acme-staging-v02.api.letsencrypt.org/directory`:
Let's Encrypt's staging server has looser rate limits, and browsers do not
trust its certificates. Delete `/srv/map-animator/tls/` before switching to
the real one.

## Users

`users.txt` in the data folder holds one user per line, `name:scrypt:<salt>:<hash>`.
Passwords are stored only as scrypt hashes, so use the tool to add a user or
change a password; to remove one, use the tool or delete the line.

```sh
docker exec -it map-animator node /app/server/passwd.mjs add alice      # add, or new password
docker exec -it map-animator node /app/server/passwd.mjs remove alice
docker exec -it map-animator node /app/server/passwd.mjs list
```

The server reads the file again by itself within a few seconds of a change.
`docker kill -s HUP map-animator` makes it do so at once. A user who is no
longer in the file is logged out. After ten failed logins from one address,
that address has to wait a quarter of an hour.

**Without `DOMAIN`, the server speaks plain HTTP.** There is no
certificate then, so passwords and session cookies cross the network unencrypted.
Give it passwords used nowhere else. If the network between you and the
server is not trusted, reach it through an SSH tunnel instead of exposing
the port (`ssh -L 8080:localhost:8080 <server>`, then open
`http://localhost:8080/`).

## Settings

All by environment variables (`docker run -e NAME=value`):

| variable              | default                   | what                                                           |
| --------------------- | ------------------------- | -------------------------------------------------------------- |
| `PORT`                | `8080`, `80` with DOMAIN  | port to listen on for HTTP                                     |
| `HOST`                | `0.0.0.0`                 | address to listen on                                           |
| `DOMAIN`              |                           | domain name(s) for HTTPS; see above                            |
| `HTTPS_PORT`          | `443`                     | port to listen on for HTTPS, with DOMAIN                       |
| `ACME_EMAIL`          |                           | contact address for the Let's Encrypt account                  |
| `ACME_DIRECTORY`      | Let's Encrypt             | the ACME server to get certificates from                       |
| `DATA_DIR`            | `/data` (image)           | users file and jobs; `server/data/` when run from the repo     |
| `USERS_FILE`          | `$DATA_DIR/users.txt`     | the users file                                                 |
| `KEEP_DAYS`           | `28`                      | finished, failed and cancelled renders are deleted after this  |
| `MAX_QUEUED_PER_USER` | `10`                      | renders one user may have waiting at a time                    |
| `RENDER_ARGS`         |                           | extra arguments for every render, e.g. `--frame-timeout 60000` |
| `RENDERER`            | `../render/render.mjs`    | the renderer                                                   |
| `SITE_ROOT`           | `/app/site` or `../build` | the built editor                                               |
| `FFMPEG`              | `ffmpeg`                  | ffmpeg, for previews                                           |

Renders are CPU-bound: a 10-second HD animation takes a few minutes on a
small server, 4K or motion blur many times that. The page shows how long a
running render has left.

## Data

```
/data/
  users.txt
  jobs/<id>/job.json      settings, status, progress, error output
  jobs/<id>/video.mp4     the render (.mov or .mkv for the other formats)
  jobs/<id>/preview.mp4   320 px, muted, for the list
  jobs/<id>/poster.jpg
  tls/account.key         with DOMAIN: the Let's Encrypt account
  tls/key.pem, cert.pem   the certificate and its key
```

A job that was rendering when the server stopped is rendered again from the
start on the next start. Old jobs are deleted at start and every hour.

## Routes

| route                               | what                                                         |
| ----------------------------------- | ------------------------------------------------------------ |
| `/`, `/view`                        | the editor and its player                                    |
| `/renders/`                         | the user's renders                                           |
| `/renders/login`, `/renders/logout` | log in and out                                               |
| `GET /api/me`                       | `{ user }` — how the editor knows it can render here         |
| `GET /api/jobs`                     | the user's jobs, newest first                                |
| `POST /api/jobs`                    | `{ link or hash, title, settings }` → a new job              |
| `DELETE /api/jobs/<id>`             | cancel a queued or running job, or delete a finished one     |
| `GET /api/jobs/<id>/video`          | the video (`?download` to save it); also `preview`, `poster` |

Everything but the login page needs a session cookie; the API answers 401
without one.

## Develop

```sh
npm run build                                   # the editor the server serves
echo 'a-password' | node server/passwd.mjs add me
node server/server.mjs                          # http://localhost:8080/
npm test                                        # includes server/*.test.mjs
```

Run from the repository, the server uses `render/render.mjs` directly, so the
renderer's own dependencies (`cd render && npm ci`) and ffmpeg have to be
installed.
