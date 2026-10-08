# GeoJSON Bbox Mismatch Fixer

Standalone static site for comparing declared GeoJSON bbox values with coordinate-derived tight bounds, replacing differing values, and downloading a repaired file. No dependencies, account, API, upload or telemetry.

## Run locally

Node.js 20+:

    npm start

Open http://127.0.0.1:8788/. Run npm test for the engine regression suite. Run npm run build to create the deployable dist/ directory. Deploy dist/ as static assets; a Node process is not required in production. Configure the same or stricter CSP, X-Content-Type-Options: nosniff, and HTTPS on the static host.

## Boundaries

- Maximum input: 5 MiB; maximum 200,000 positions and 64 nested JSON levels.
- Checks bbox members on GeoJSON objects. Other objects such as properties are preserved and not treated as GeoJSON.
- A difference from the **tight** calculated box is not necessarily an RFC violation. A broader declared bbox may be intentional.
- The tool does not repair coordinates, antimeridian crossing geometry, projection, polygon topology or general GeoJSON validity.
- Empty/null geometry with a declared bbox cannot be verified, so automatic repair is blocked.
- Input stays in the current browser tab. The original input is not overwritten; download is a new file.
- The downloaded JSON is reserialized. Formatting changes, and browser number parsing can round unusually precise numeric literals. Compare the preview with the original when exact lexical representation matters.
