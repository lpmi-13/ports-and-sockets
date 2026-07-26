# Ports ≠ Sockets

An interactive TypeScript explainer for the three references to a single
network connection — the distinction that matters when you're debugging.

The same TCP connection gets named three ways, because three different actors
each need to reach it:

- the **remote host** (and the kernel's packet demux) name it by its **port** —
  it's what's on the wire;
- the **process** names it by a **file descriptor** — `read(4)`, never
  `read(:80)`; after `accept()` returns, the port is gone from user space;
- the **kernel** owns the **socket** itself — the buffers, the TCP state, the
  object both sides point at.

The site makes each accepted nginx connection the primary visual object.
Connections appear as lanes from a public remote endpoint to
`192.168.1.10:80`. Opening one lane reveals a single horizontal journey
through its remote port, kernel socket and 5-tuple, and nginx file descriptor.
Connections start collapsed and only open when clicked. One connection can be
expanded at a time, and the demo does not impose a connection-count cap. The
live connection total remains visible in the fixed header while the list
scrolls.

## What you can do

- **Accept** a client and watch a new remote-host-to-nginx connection lane
  appear.
- **Open** a connection to reveal its Port → Socket → FD reference journey.
- **Scroll horizontally** through the expanded journey on narrow screens.
- **Close selected** and watch that complete connection disappear.

## Run locally

```sh
npm install
npm run dev
```

Then open <http://localhost:5173>.

## Production build

```sh
npm run build
npm run preview
```

Vite writes the production site to `dist/` and minifies the compiled
JavaScript and CSS. JavaScript, CSS, and the favicon use content-hashed
filenames, while the HTML is revalidated so browsers discover the latest
asset URLs after each deploy.

## Deploy

The repository includes a `netlify.toml` that builds the TypeScript app and
publishes `dist/`.
