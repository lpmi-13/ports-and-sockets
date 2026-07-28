# Ports ≠ Sockets

An interactive TypeScript explainer for the three references to a single
network connection — the distinction that matters when you're debugging.

The same TCP connection gets named three ways on each host, because three
different actors need to reach it:

- the connection is addressed on the wire by its two IP-and-port endpoints;
- each host's **kernel** owns a different local **socket** for that connection;
- each host's **process** reaches its socket through a process-local **file
  descriptor**.

The site makes each accepted nginx connection the primary visual object.
Connections appear in a many-to-one map and as inspectable lanes from public
client endpoints to the documentation-safe public nginx endpoint
`198.51.100.80:80`. Opening one lane reveals a horizontal journey through its
port, local kernel socket and five-tuple, and process file descriptor. A
Client host / Server host control switches those local references without
moving or replacing the underlying connection.

Connections start collapsed and only open when clicked. One connection can be
expanded at a time, and the demo does not impose a connection-count cap. Dense
overview sets aggregate visually while every connection remains available in
the complete list. Adding a connection preserves the viewport; when its lane
lands below the fold, a small notice offers to reveal it. The live total
remains visible in the fixed header while the list scrolls.

## What you can do

- **Accept** a client and watch a new client-host-to-nginx connection lane
  appear.
- **Switch perspective** to compare the client application's socket and FD
  with nginx's separate socket and FD for the same connection.
- **Use the topology map** to see many clients converge on nginx and open a
  connection directly.
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
