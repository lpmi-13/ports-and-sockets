# Ports ≠ Sockets

An interactive, dependency-free visual guide to the distinction between ports and sockets in the Linux networking stack.

## Run locally

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploy

The repository includes a `netlify.toml`, so Netlify can deploy it without a
build command. Set the repository as the site source and Netlify will publish
the project root.
