# GeoJSON Bbox Mismatch Fixer

Standalone static site for comparing declared GeoJSON bbox values with coordinate-derived tight bounds, explaining each difference, copying a calculated bbox, replacing differing values, and downloading a repaired file. No dependencies, account, API, upload or telemetry.

## Run locally

Node.js 20+:

    npm start

Open http://127.0.0.1:8788/. Run npm test for the engine regression suite. Run npm run build to create the deployable dist/ directory. Deploy dist/ to Cloudflare Pages; a Node process is not required in production. The generated `_headers` file applies the local preview's CSP and other security headers. It limits `noindex` to Pages-hosted preview URLs so a custom domain can be indexed.

## Boundaries

- Maximum input: 5 MiB; maximum 200,000 positions and 64 nested JSON levels.
- Checks bbox members on GeoJSON objects. Other objects such as properties are preserved and not treated as GeoJSON.
- A difference from the **tight** calculated box is not necessarily an RFC violation. A broader declared bbox may be intentional.
- Difference explanations distinguish coordinates outside the declared bbox, broader boxes, and unusable bbox values. Wrapped antimeridian cases use neutral wording when containment is uncertain.
- Each calculated bbox can be copied as a compact JSON array in longitude, latitude, then optional elevation order. A manual copy value appears when clipboard access fails.
- The tool does not repair coordinates, antimeridian crossing geometry, projection, polygon topology or general GeoJSON validity.
- Empty/null geometry with a declared bbox cannot be verified, so automatic repair is blocked.
- Input stays in the current browser tab. The original input is not overwritten; download is a new file.
- The downloaded JSON is reserialized. Formatting changes, and browser number parsing can round unusually precise numeric literals. Compare the preview with the original when exact lexical representation matters.

## Search indexing

The canonical public URL is https://bboxfixer.com/. The build includes `robots.txt` and a one-page `sitemap.xml` at the site root. Submit `https://bboxfixer.com/sitemap.xml` in Google Search Console after verifying ownership of the domain. The `www` hostname redirects to the canonical host; Pages preview domains remain `noindex`.
