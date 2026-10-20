# UI and document fonts

The UI requests `Sukhumvit Set`, then falls back to Tahoma, Arial and sans-serif.
There are currently **no Sukhumvit Set webfont files** in this repository.
The family name can resolve an installed system font; it does not provide a
consistent webfont across Windows, Android, iOS and other devices.

To complete webfont delivery, obtain files licensed for web embedding:

- Regular (400), preferably WOFF2.
- Medium (500) and/or Semibold (600), matching the actual available font files.
- Bold (700) if used; do not register the same regular file as multiple weights.
- The accompanying license or permission covering web redistribution.

After receiving these files, add matching `@font-face` declarations with
`font-display: swap`, verify the rendered Thai glyph font using browser font
inspection, then repeat the responsive and enlarged-text screenshots.
Do not download an unverified copy or point CSS to nonexistent font URLs.

TH Sarabun New's existing regular, bold, italic and bold-italic WOFF files remain
the document fonts. Their license files are retained. `--font-document` controls
the A4 editor and ticket sheets; shared exports separately embed `FormThai`.
Changing `--font-app` must not change these document metrics or export fonts.
