# UI and document fonts

Aurora uses self-hosted Inter for Latin/numbers and Noto Sans Thai for Thai, with system-ui and sans-serif fallbacks. styles/fonts.css registers real 400/500/600/700 faces with font-display: swap. No external font request or extra CSP origin is required.

Sources: https://github.com/google/fonts/tree/main/ofl/inter and https://github.com/google/fonts/tree/main/ofl/notosansthai . Matching SIL Open Font License texts: inter-OFL.txt and notosansthai-OFL.txt. Retrieved from the Google Fonts CSS API on 2026-10-29, then losslessly compressed from TTF to WOFF2 with fontTools/Brotli. Retain the licenses when redistributing.

aurora-ui-0 through aurora-ui-3 are Inter 400/500/600/700; aurora-ui-4 through aurora-ui-7 are Noto Sans Thai 400/500/600/700. Total UI font assets: 527,996 bytes. Chromium CDP verifies actual Thai glyph rendering in e2e/aurora.spec.ts.

Existing TH Sarabun New regular, bold, italic and bold-italic WOFF files remain the document fonts, with their existing licenses. --font-document controls A4 editors and ticket sheets; shared exports separately embed FormThai. UI font, font size and density must not change document metrics or export fonts.
