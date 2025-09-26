# Bad Apple HTMX Demo

Server-driven ASCII animation using the **server-commands extension** for htmx.

This is an alternative to the datastar framework demo, but keeping the familiar htmx mindset - just with the `hx-` attributes being set from the server inside `<htmx>` tags.

## Quick Start

```bash
cp .env.example .env
docker compose up
# or
just up
```

## How it works

The server streams `<htmx>` tags via SSE to update multiple elements:

```html
<htmx target="#frames" swap="textContent">ASCII frame content</htmx>
<htmx target="#progress" swap="textContent">42.5%</htmx>
```

Server-commands supports everything htmx can do:
- **Swap modifiers**: `<htmx target="#chat" swap="beforeend scroll:bottom">`
- **Select content**: `<htmx target="#main" select="#content">`
- **Trigger events**: `<htmx trigger="chatMessage">`
- **Navigation**: `<htmx refresh>` or `<htmx location="/page">`
- **Works with SSE extension** out of the box

## Notes

- The `htmx.js` file used in this demo includes changes from [PR #3425](https://github.com/bigskysoftware/htmx/pull/3425) to expose history functions to extensions
- The server-commands extension is available at https://github.com/scriptogre/htmx-extensions