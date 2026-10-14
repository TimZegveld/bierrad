# Onderhoudsreview — 2026-10-13

Deze wijziging voert de door de eigenaar goedgekeurde reviewvoorstellen uit. De bindende controle is uitgevoerd tegen `SECURITY.md`.

## Login en intrekking

- De cookie bevat alleen een willekeurige locator (128 bits) en een geheim (256 bits), met `__Host-`, `HttpOnly`, `Secure`, `SameSite=Lax` en tien minuten geldigheid. Hij kan geen app of doelkanaal meer kiezen.
- Een apart object per poging in de bestaande `CHANNELS`-namespace (`login:<locator>`) bewaart de hash van het geheim, state, nonce, doel, app en vervaltijd. Persoonlijke pogingen bewaren daarnaast alleen de bestaande kanaalgeneratie (`requestHash`) en de hash van de oorspronkelijke capability. Geen gebruikersprofielen, gebruikerstokens of Slack-gebruikersidentiteiten worden opgeslagen.
- Een transactie controleert en verbruikt de poging eenmalig vóór Slack-I/O. Verkeerde cookies, state, verlopen pogingen en replay worden geweigerd. Een alarm verwijdert verlaten pogingen.
- Bindpogingen gebruiken vóór opslag de bestaande creatielimieten. Persoonlijke starts blijven begrensd per IP en tot dertig per kanaal per minuut. Dit is geen globale botbescherming.
- Na Slack-I/O controleert het kanaal opnieuw generatie, oorspronkelijke toegang, workspace, app en geldigheid. Ook na het berekenen van het pseudoniem wordt opnieuw gecontroleerd. Rotatie, opnieuw koppelen, uitloggen en ontkoppelen kunnen een begonnen login dus ongeldig maken.
- Kanaalverzoeken controleren toegang opnieuw na het ophalen van rondegegevens; ook kijklinks moeten dan nog dezelfde geldige hash hebben. Interne locators geven geen rechten.

## Uitslag en herstel

- Uitslagen blijven minimaal dertig minuten na de start zichtbaar en zo nodig tot vijf minuten na de reviewdeadline, nooit voorbij de bestaande sessieduur van één uur. Het kanaalalarm doet die controle ook zonder kijkers. Er worden geen extra stemmen, teksten of identiteiten opgeslagen. Een nieuwe ronde vervangt nog steeds de getoonde ronde.
- Seriële polling voorkomt overlappende pollverzoeken en negeert antwoorden na het verlaten van een pagina. Tijdelijke netwerk- en 5xx-fouten blijven opnieuw proberen; alleen een 404 maakt de toegang definitief ongeldig. Succes wist de tijdelijke foutmelding.
- Slack-berichtafhandeling is verplaatst naar `worker/slack/jobs.ts`. Claims vóór I/O, expliciete herleescontroles, begrensde retries en het wissen van reviewteksten blijven behouden.

## Validatie en publicatie

Regressietests gebruiken uitsluitend synthetische data en een nagebootste Slack-service: cookieverwisseling, legacy cookies, replay, gelijktijdige callbacks, serverzijdige expiry, opruimen, uitloggen, linkrotatie tijdens tokenuitwisseling, opnieuw koppelen, langere reviewweergave en herstel na 503. Bestaande tests bewaken trekautoriteit, privacy-DTO's, Slack-uitvoer en deterministische weergave.

ESLint controleert frontend, gedeelde en backendproductiecode op hooks, promises en ongebruikte variabelen; dezelfde opdracht draait in CI. Wrangler en Miniflare blijven op overeenkomstige versies. De ongebruikte opslag voor lokale winkansen is verwijderd; lokale raderen starten nog steeds leeg met standaardinstellingen.

Geen nieuwe secrets, Slack-scopes, bindings of Durable Object-migraties. Publiceer de Worker vóór het frontend. Een login met de oude cookie moet opnieuw worden gestart; bestaande kanaal-, kijk- en persoonlijke links blijven bruikbaar. De review en tests vervangen geen rooktest in de echte Slack-workspace na publicatie. Logs/observability blijven uit; secrets en productiegegevens zijn niet nodig voor deze controles.

### Eindcontrole — 2026-10-14

Alle 178 tests slagen (99 frontend, 79 backend), evenals lint, beide typechecks en de frontendproductiebuild plus Worker-dry-run. De volledige npm-audit meldt nul bekende kwetsbaarheden. De diff en afhankelijkheden zijn gecontroleerd. De credentialscan vindt geen credentials; de browsercode en gebouwde frontend bevatten geen servergeheimvelden. De aangetroffen verboden `VITE_`-namen staan uitsluitend als waarschuwende voorbeelden in bestaande beveiligingsdocumentatie. Er zijn geen echte medewerkersgegevens of private bedrijfsgegevens toegevoegd. Er is lokaal getest; productie is niet gewijzigd.

De Feestrad- en Bierfeestwijzigingen uit `main` zijn geïntegreerd. De nieuwe feestthema’s en alle vijf verplaatste Slack-jobs zijn structureel met de huidige main-code vergeleken: hun gedrag is behouden. De bovenstaande controles zijn na de integratie opnieuw uitgevoerd.
