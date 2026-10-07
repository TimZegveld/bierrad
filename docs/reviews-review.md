# Rondereviews (koffie en water): security- en implementatiereview — 2026-10-06

Implementatiereview tegen [SECURITY.md](../SECURITY.md#round-reviews--reviewed-exception-2026-10-06). Dit is geen onafhankelijke audit. De tests gebruiken alleen synthetische deelnemers en Slack-antwoorden. Er is niet tegen een echte Slack-workspace of Cloudflare-productie getest.

## Nieuw oppervlak

| Oppervlak | Autorisatie | Opmerkingen |
| --- | --- | --- |
| `POST /auth/slack/member` | Een geldige kanaallink (beheer-, aanvraag- of persoonlijke link) in een formulierbody | De Origin moet op de allowlist staan; daarom gebruikt de frontend het referrerbeleid `strict-origin` en heeft het formulier geen `rel="noreferrer"` (anders sturen browsers `Origin: null`). De body is `application/x-www-form-urlencoded`, hooguit 1 KiB, met precies één veld `capability` en zonder query. Er gaan hooguit 30 logins per kanaal per minuut. Daarna volgt Sign in with Slack met het doel `member-<locator>` in de logincookie. |
| `GET /auth/slack/callback` (doel member) | De bestaande OIDC-controles; alleen volwaardige leden van de workspace van de bot | Het gebruikerstoken wordt ingetrokken. De user-ID wordt alleen omgezet in een pseudoniem. De persoonlijke link komt alleen in het fragment terecht. Fouten komen uit op `#/koffie-login/<reden>`. |
| `/api/channel`, rol `member` | De SHA-256-hash van een geheim van 256 bits, timing-safe vergeleken, met een vervaldatum | Heeft de rechten van de aanvraaglink, plus `review` en `logout`. Een member mag nooit beheren (403) en, net als elke kanaallink, nooit een ronde starten (400). |
| `/api/channel` `setReviews` | Alleen de beheerder | Strikte vorm: `enabled` boolean, `minutes` ∈ {5, 10, 15, 30}. |

## Gegevens

- **Kanaal:** een HMAC-sleutel per koppeling, en per persoonlijke link alleen `{hash, pseudoniem, verloopt}`. Verder de reviewinstelling en hooguit vijf sessielocators van rondes met reviews; een locator geeft zelf geen toegang. Er worden geen Slack-ID's, namen of ruwe persoonlijke links opgeslagen; de integratietest controleert dat.
- **Sessie:** tot het sluiten de sleutel, de kanaallink, de pseudoniemen van wie mag stemmen en van wie gestemd heeft, en per winnaar de som, het aantal en de teksten. Bij het sluiten worden de pseudoniemen, de sleutel en de link gewist. De teksten worden gewist zodra het threadbericht is afgehandeld. De rest verdwijnt met de sessie, één uur na de start.
- **DTO's:** toeschouwers zien alleen `{closesAt, voted, eligible}`; een persoonlijke link ziet alleen de eigen deelname en het eigen stembiljet.

## Standaard

Reviews staan standaard aan, met 15 minuten stemtijd, ook voor bestaande koppelingen zonder opgeslagen keuze (gevraagd door de eigenaar op 2026-10-06). Daardoor linkt een oproep standaard naar de kanaalpagina in plaats van naar de woordlink. Dat is dezelfde link die al in het koppelbericht staat, dus het publiek wordt niet groter. De beheerder kan reviews uitzetten. Sinds 2026-10-06 starten rondes alleen met `/koffierad` of `/waterrad` en volgen ze altijd die kanaalinstelling; per aanvraag aan- of uitzetten bestaat niet meer.

Stemmen opent een minuut na de finale (gevraagd door de eigenaar), en de stemtijd telt vanaf dat moment. Een persoonlijke pagina vraagt het stemformulier op dat moment op en vijf seconden later nog eens; daarnaast pollt hij elke 10 seconden.

## Gecontroleerde risico's

- **Winnaar uitlekken:** stembiljetten openen pas een minuut na de laatste onthulling, en de server weigert te vroege stemmen.
- **Dubbel stemmen:** één stem per pseudoniem, binnen het Durable Object, zonder await tussen controle en schrijven. Een nieuwe login geeft hetzelfde pseudoniem en dus geen nieuwe stem.
- **Op jezelf stemmen:** de winnaar staat niet op de lijst van wie mag stemmen (403), en een stembiljet bevat nooit jezelf.
- **Injectie in Slack:** de teksten staan als tekstelementen in een `rich_text_list`, één bolletje per review, met `parse: none` en een ge-escapete fallback. `<!channel>`, mentions en links blijven letterlijke tekst. Alleen de server-bevroren identiteit van de winnaar staat ook in de fallback als `<@U…>`, omdat Slack daaruit de notificatie afleidt (2026-10-06). De invoer wordt opgeschoond: geen stuurtekens en geen bidi-overrides.
- **Herleidbaarheid:** bij het posten worden de teksten geschud en blijven er geen stemmen per persoon over. Na ontkoppelen is de sleutel weg.
- **Linklekken:** de kanaallink staat nooit in een backend-URL. De CSP `form-action` staat alleen self, de backend en slack.com toe. De oproep linkt alleen bij rondes met reviews naar de kanaalpagina; die link stond al in het koppelbericht.

## Geaccepteerde beperkingen

- **Persoonlijke links zijn bearer-toegang.** Wie er een doorgestuurd krijgt, kan namens die persoon stemmen.
- **Anoniem is niet ondoorzichtig.** In kleine groepen valt de schrijver soms te raden. Teksten worden niet gemodereerd en zijn zichtbaar voor iedereen in het kanaal, ook Slack Connect-leden.
- **Een mislukte of onzekere threadpost wordt niet herhaald** (hooguit één retry na een duidelijke weigering). Ook na een mislukte post verdwijnen de teksten.
- **Een sleutel die pas tijdens de ronde wordt aangemaakt:** bestaande rondes gebruiken de sleutel die er bij hun start was. Opnieuw koppelen tijdens een open review maakt stemmen in die ronde onmogelijk.

## Bierrad-sessies (PR 3, verwijderd)

De reviews voor sessies die met Sign in with Slack waren gestart, met hun deelnamelink, `/api/join` en `/auth/slack/join`, zijn op 2026-10-07 samen met "Start met Slack" verwijderd. Zie `docs/slack-security-review.md`.

## Verificatie

- **`worker/tests/reviews.test.ts`:**
  - openen pas na de onthulling, en wie mag stemmen (zonder de winnaar en zonder onbekenden);
  - strikte stembiljetten, één stem per persoon, sluiten bij de laatste stem en wissen;
  - geen post als niemand stemt;
  - een oproep zonder uitnodiging als niemand kan stemmen;
  - de tekst van de oproep met en zonder sterren, en hele sterren;
  - de threadpost met letterlijke quotes en zonder broadcast;
  - het opschonen van tekst;
  - de logincookie met het doel `member`.
- **`worker/tests/reviews-live.test.ts`** (echte Worker en SQLite, nep-Slack):
  - geweigerde login-starts (Origin, verkeerde link, extra veld, contenttype, GET);
  - persoonlijke logins via de aanvraag-, beheer- en persoonlijke link, waarbij een nieuwe login de oude link vervangt;
  - geen identiteit in de kanaalopslag, en geen beheerrechten voor members;
  - een oproep met "Open de ronde";
  - geen stembiljet tijdens het draaien, wel daarna; winnaar en niet-deelnemers krijgen geen stembiljet;
  - voortgang met alleen aantallen;
  - geweigerd: stemmen op jezelf, ongeldige score of tekst, dubbel stemmen;
  - sluiten na de laatste stem, met de threadpost met quote en de bijgewerkte oproep met sterren;
  - geen stemmen, teksten, pseudoniemen, sleutel of link meer in de sessie;
  - uitloggen, en roteren dat alle persoonlijke links beëindigt.
- **`src/tests/channel.test.ts`:** de route `#/koffie-login/<reden>`.
- **Visueel:** het stemformulier en de inlogkeuze, gecontroleerd in de ingebouwde browser op desktop en 375 px (koffie en water). Er is geen horizontale overloop, en verzenden zonder sterren geeft een foutmelding in de tekst.
