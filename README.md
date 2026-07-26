# Ports ≠ Sockets

An interactive, dependency-free explainer for the distinction between ports
and sockets in Linux — built around a real, recognizable example (an nginx
web server) and, above all, around *why the difference matters* to engineers.

A **port** is the address a server *listens on* — there's exactly one. A
**socket** is a *connection* — there are many, one per client, and it's the
file descriptor your code actually `read()`s and `write()`s. You operate a
live nginx server and watch the kernel socket table: the port stays one while
the sockets multiply. Then you break it the way production does.

## Three acts

- **Act I — Bind & Accept.** Accept clients and watch one `LISTEN` socket fan
  out into many `ESTAB` sockets — same `:80`, one fd each. Start a second
  nginx and hit `bind(): Address already in use`; keep accepting and hit
  `accept(): Too many open files` at `ulimit -n`. *One port, many sockets;
  EADDRINUSE is a bind conflict, not a connection limit; capacity is bounded
  by file descriptors (C10K), not ports.*
- **Act II — Outbound.** Now nginx is the client, dialing an upstream. Each
  outbound connection borrows a local **ephemeral source port**; churn them
  and hit `connect(): Cannot assign requested address`, with `TIME-WAIT`
  holding ports for ~60s. *Inbound, one port holds unlimited sockets;
  outbound, each socket spends a source port — the limit flips to your side.*
- **Act III — Scale.** Add workers with `SO_REUSEPORT`: many listening
  sockets on the *same* `:80`, the kernel spreading accepts across them.
  *The port is one address; you scale with sockets, workers and machines —
  never more ports.*

Every claim is backed by the real output you'd see in `ss`, `lsof`, `/proc`
and the actual kernel error messages.

## Run locally

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploy

The repository includes a `netlify.toml`, so Netlify can deploy it without a
build command. Set the repository as the site source and Netlify will publish
the project root.
