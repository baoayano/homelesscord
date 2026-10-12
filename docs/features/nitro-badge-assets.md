# Nitro badge artwork

The bundled Nitro badge artwork comes from Discord's badge CDN, retrieved on October 12, 2026. [Evolving Nitro Badges](https://support.discord.com/hc/en-us/articles/29136565881623-Evolving-Nitro-Badges) describes the progression. The local collection contains the default badge and milestones at 1, 3, 6, 12, 24, 36, 60 and 72 months.

`assets/badge-icons/nitro-manifest.json` records each upstream icon hash, download URL, SHA-256 digest, image dimensions and existing local filename. PNGs contain the original downloaded bytes. The default PNG is 72 by 72 pixels and milestone PNGs are 80 by 80 pixels. SVG companions embed the same PNG bytes at a 24 by 24 display size, preserving existing filenames without recreating the artwork or requesting a remote image.

The default local filename remains `2ba85e8026a8614b640c2837bcdfe21b.png`. Milestones keep `premium_tenure_<months>_month_v2.png`. These assets are available through the local CDN's badge route. This asset update does not enable profile badges: profile responses still filter subscription badges. Free evolving badges for ordinary accounts are planned separately.

The badge CDN route caches successful responses for 6 hours with `immutable`. After deploying replacement images at these existing URLs, an already cached image can remain visible until expiry. Refresh the affected browser or CDN cache when verifying the new artwork.

Check the pinned files offline:

```sh
bun scripts/tenure-badges.js --check
```

Run `bun scripts/tenure-badges.js` to regenerate SVG companions from the bundled PNGs without network access. Run `bun scripts/tenure-badges.js --download` to download the pinned PNGs again and regenerate companions. All PNGs must pass signature, dimensions and SHA-256 checks before the download command replaces any files. The old procedural gemstone renderer is no longer used.

For a later artwork update, verify the mapping against Discord's current badges, download originals into staging, inspect them and update the manifest with their digests and dimensions. Keep client code and cached Discord bundles outside Git.
