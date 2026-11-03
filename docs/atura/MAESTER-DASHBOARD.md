# Maester-dashboard — security- en architectuurcontract

Status: ontwerp in uitvoering; geen deployment of klantonboarding. De uitvoeringskeuzes staan in het private Hermes-plan `2026-11-03_161313-maester-dashboard-everyapp.md`. Deze tekst is een reviewbaar contract voor de code en de latere uitrol.

## Scheiding en eerste pilot

- Een afzonderlijke EveryApp-managed app `maester-dashboard` met een eigen D1 en R2. Niet in de Gateway-database en niet als navigatielink naar GitHub. Private app-routes krijgen Cloudflare Access, Gateway-appgrants **en** server-side autorisatie. Het EveryApp registratiesysteem geeft nieuwe private apps standaard ook aan bestaande owners/admins; een Mikkie-only pilot vereist dus een extra server-side exact-identity check en een read-back van de uiteindelijke grants.
- Alleen de reeds geautoriseerde Atura-tenant in de pilot. Toekomstige klanten krijgen ieder een eigen private scanrepository, scanner-Entra-app en GitHub OIDC-federatie, na afzonderlijk mandaat. Een klantenfilter in de browser is geen isolatie; een interne tenantregistratie bindt immutable repo-ID en expliciet toegestane workflow/ref aan tenant-ID. Klanten hebben geen portaaltoegang.
- De bestaande dagelijkse Maester-pilot (twee controles) en de handmatige CIS-v7-workflows hebben verschillende testsets; toon ze apart. Vergelijk alleen controle-ID's met gelijke versie/betekenis. Geen compliancepercentage over alleen uitgevoerde checks; Failed, Skipped, NotRun en technische Error zijn verschillende uitkomsten. Een rode GitHub-run kan een echte bevinding bevatten en is geen bewijs dat import of tenantauth faalde.
- Geen automatische scantrigger, tenantremediatie of klantverzending vanuit het dashboard. De Hermes Maester-agent blijft operationeel gescheiden.

## Veilige invoer

- De GitHub-runner exporteert vóór artifactupload een **kleine, versiegenummerde allowlistprojectie**; raw Maester-JSON kan tokens bevatten en blijft runner-lokaal. De bestaande HTML/Markdown-rapporten worden gecontroleerd vóór private archivering. Bouw de import pas nadat een echt Atura-rapport aan het exportschema is getoetst (titels, skips en workflowuitkomst), zonder rapportdata in logs of git te tonen.
- Gebruik als voorkeursroute een repo-specifieke GitHub App met `Metadata: read` en `Actions: read`, en kortlevende installation tokens. Een scheduled handler van de private app reconcilieert voltooide runs; dit vereist geen publieke route of Access-bypass. GitHub App-identiteit, installatie en repo-ID moeten voor de pilot echt worden geverifieerd. Bewaar de private sleutel buiten git met rotatie- en incidentprocedure. Reconciliation moet na storing opnieuw starten en achterstand binnen de GitHub-artifactretentie afwerken; alleen `workflow_run` success importeren zou bevindingen missen.
- Importeer uitsluitend allowlisted workflowtypes/branches/repo-IDs, verifieer tenant, artifact-ID/digest en schema. Idempotentie op immutable repo-ID, run-ID, poging en artifact. Begrens ZIP-download, entries, decompressie, JSON en HTML. Houd importstatus en foutcode auditbaar, maar niet ruwe foutdetails. Bij een verlopen/ontbrekend artifact: toon ontbrekende bron zonder historie te fabriceren.
- Een latere webhook is optioneel. Het EveryApp-manifest zet een publieke route om in een Cloudflare Access-bypass voor precies dat pad; een Gateway-appgrant beschermt deze route niet. Alleen na een afzonderlijke HMAC/raw-body/replay/allowlist-review, nooit een brede `/api/**`-uitzondering.

## Opslag, weergave en rapportage

- Eigen D1 bevat tenant-/run-/controlemetagegevens, importlog, PDF-versies, goedkeuring en retentieaudit; eigen R2 bevat gecontroleerde originele HTML en gegenereerde PDF. Gebruik gescheiden staging- en productiebindingen. Authenticeer en filter op serverzijde bij **iedere** query, objectdownload en mutatie; negatieve tests voor cross-tenant ID's, accountwissel en intrekking.
- Bied origineel HTML alleen als `attachment` op een geïsoleerde origin of in een niet-uitvoerbaar archiefformaat aan; voer het nooit in de app-origin uit. Geheimdetectie is aanvullend en bewijst niet dat alle gevoelige gegevens verwijderd zijn. Beveilig logs, downloadresponse en caches.
- Genereer een Atura-branded concept-PDF uit interne ge-escapete data, niet uit onbetrouwbare Maester-HTML. Onderzoek lokaal en in staging of Cloudflare Worker PDF-rendering/Browser Rendering beschikbaar is; de SDK kent een binding maar dat bewijst geen functionerende renderer. Een bevoegde Atura-medewerker keurt een specifieke versie/digest zelf expliciet goed. Nieuwe inhoud vergt nieuwe goedkeuring. Versturen naar klant is handmatig buiten de app.
- Bewaar rapporten, gestructureerde gegevens en PDF maximaal twaalf maanden per tenant; test verwijdering van D1-referenties én R2-objecten inclusief auditbewijs. Breng back-ups en eventuele wettelijke/contractuele bewaarexcepties vóór productie in kaart.

## Releasegates

1. Test de export eerst op synthetische gevallen én een gecontroleerde echte Atura-uitvoer zonder gevoelige inhoud te loggen. Alle relevante tests en review op het exacte PR-head moeten groen zijn.
2. Bouw de app en test de scheduled GitHub App-import, R2/D1-readback, originele download, scopevergelijking, PDF en goedkeuring op **staging**, met Mikkies echte login en expliciet weigeren van onbevoegden. Verifieer dat de bestaande Gateway, appgrants, owners en Access-methoden onaangetast blijven.
3. Maak voor een afzonderlijk goedgekeurde productie-uitrol verse back-ups en hersteltests van de relevante appresources, leg Worker-versie en rollbackstrategie vast. R2/D1 rollback kan latere writes verliezen en is geen automatische optie. Lees release, routes, auth, scopes, geïmporteerde run en retentie na uitrol terug.
4. Geen echte klanttenant koppelen zonder een aparte onboardingautorisatie voor repo, Entra-rollen, rapportpubliek, mandaat en bewaarbeleid.

Bronnen binnen deze checkout: `starter/everyapp.config.ts`, `starter/src/entry.worker.ts`, `packages/sdk/src/server/everyApp.ts`, `packages/sdk/src/cloudflare/worker.ts`, `packages/perimeter/src/install/access-plan.ts`, `packages/perimeter/src/registry/registration.ts`. Bestaande scanner: `atura-nl/maester-monitoring` (`README.md`, scanworkflows en `scripts/check_report.py`).
