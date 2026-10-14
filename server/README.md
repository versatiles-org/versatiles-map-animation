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

**The server speaks plain HTTP.** Without a domain name there is no
certificate, so passwords and session cookies cross the network unencrypted.
Give it passwords used nowhere else. If the network between you and the
server is not trusted, reach it through an SSH tunnel instead of exposing
the port (`ssh -L 8080:localhost:8080 <server>`, then open
`http://localhost:8080/`).

## Settings

All by environment variables (`docker run -e NAME=value`):

| variable              | default                   | what                                                           |
| --------------------- | ------------------------- | -------------------------------------------------------------- |
| `PORT`                | `8080`                    | port to listen on                                              |
| `HOST`                | `0.0.0.0`                 | address to listen on                                           |
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
