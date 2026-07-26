# Ports ≠ Sockets

An interactive, dependency-free explainer for the three references to a single
network connection — the distinction that matters when you're debugging.

The same TCP connection gets named three ways, because three different actors
each need to reach it:

- the **remote host** (and the kernel's packet demux) name it by its **port** —
  it's what's on the wire;
- the **process** names it by a **file descriptor** — `read(4)`, never
  `read(:80)`; after `accept()` returns, the port is gone from user space;
- the **kernel** owns the **socket** itself — the buffers, the TCP state, the
  object both sides point at.

The site shows one nginx connection through all three lenses at once —
`tcpdump` (Wire), `ss` (Kernel), `lsof` (Process) — with the socket in the
middle: the port routes packets *into* it, the fd reads *out* of it, and
`socket:[inode]` is the literal join key visible in both the kernel and the
process.

## What you can do

- **Accept** a client and watch the connection appear in all three lenses at
  once — a flow on the wire, a socket in the kernel, an fd in the process.
- **Click** any row to light the same connection across all three lenses and
  the connecting thread.
- **`getsockname()`** — ask the process what port it's on, and watch it have to
  syscall *into the kernel* to find out, because the port isn't in user space.

Every claim is backed by the real output you'd see in `tcpdump`, `ss`, `lsof`
and `/proc`.

## Run locally

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploy

The repository includes a `netlify.toml`, so Netlify can deploy it without a
build command. Set the repository as the site source and Netlify will publish
the project root.
