# Ports ≠ Sockets

An interactive, dependency-free visual explainer for the distinction between
ports and sockets in the Linux networking stack.

A **port** is a 16-bit number the kernel looks up. A **socket** is the kernel
object — buffers, protocol state, a file descriptor — that actually holds your
data. The site makes the difference concrete: one packet arrives at a host and
climbs the stack, and a live `ss`-style socket table narrows, field by field,
from *every socket that shares the destination port* down to the single socket
that receives the bytes.

## What you can do

- **Step** a packet through the seven stages of the climb — wire, link, IP,
  port lookup, 5-tuple demultiplexing, receive buffer, process — with the
  Prev / Next buttons, the arrow keys, or by clicking a dot on the journey
  rail. **Replay** walks the whole path automatically.
- **Watch the socket table narrow.** The port gets the packet to a *bucket* of
  sockets; the full 5-tuple picks one. Established connections beat the
  listener; a fresh SYN mints a brand-new socket that shares the same port; a
  packet to a port with no socket is rejected.
- **Tap a socket row** to inspect it, or an **anatomy row** (Port, 5-tuple,
  Socket, Listening vs. connected) to see its real fields as `ss`, `tcpdump`
  and `/proc` would show them.
- **🎲 New packet** generates a fresh arrival — an established data packet, a
  new connection, a UDP datagram, a closed port, or one that isn't even for
  this host.

## Run locally

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploy

The repository includes a `netlify.toml`, so Netlify can deploy it without a
build command. Set the repository as the site source and Netlify will publish
the project root.
