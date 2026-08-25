/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base64-encoded Google Sheets spreadsheet id, injected at build time from a
   * CI secret. Deliberately absent from this repository -- see
   * docs/DESIGN.md section 9.1. Absent in local checkouts, where the id comes from
   * `.env.local`, a `#sheet=` fragment, or the setup screen.
   */
  readonly VITE_SHEET_ID_B64?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
