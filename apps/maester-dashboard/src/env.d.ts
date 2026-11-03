/// <reference types="vite/client" />

// The bindings come from `cf workers types` (.cloudflare/types). An app secret
// listed under `secrets` in everyapp.config.ts is typed here, optional until set:
declare namespace Cloudflare {
  interface Env {
    PILOT_USER_ID?: string;
    PILOT_ORG_ID?: string;
  }
}
