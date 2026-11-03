import { defineEveryApp } from "@every-app/sdk";

// Gateway grant remains mandatory; the app also checks exact pilot identity
// and an explicit tenant_access row on every read.
export default defineEveryApp({
  id: "maester-dashboard",
  name: "Atura Maester-dashboard",
  description: "Besloten overzicht van Maester-controles voor de Atura-pilot.",
  resources: { d1: ["DB"], r2: ["REPORTS"] },
  secrets: [
    "PILOT_USER_ID",
    "PILOT_ORG_ID",
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
  ],
  public: [],
});
