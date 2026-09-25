# 🍻 Bierrad 🎡

Wie haalt deze week het bier? Voeg deelnemers toe, kies het aantal bierhalers en laat hun raderen tegelijk draaien. Warm, speels en Nederlands. **Geen discussie. Gewoon draaien.**

[Open Bierrad](https://timzegveld.github.io/bierrad/) · [Productvisie](vision.md) · [Verplichte beveiligingsregels](SECURITY.md) · [Agentinstructies](AGENTS.md)

## Lokaal of live

**Alleen op dit scherm** werkt zelfstandig, zonder backend, account of netwerk. Handmatig ingevoerde deelnemers en de voorkeur voor het aantal bierhalers worden lokaal onthouden. Iedere trekking is onafhankelijk: eerdere winnaars mogen opnieuw winnen.

**Start live Bierrad** maakt een nieuwe, lege tijdelijke sessie. Je wordt host, voert deelnemers in en deelt **Kopieer kijklink** met collega's of de kantoor-tv. Iedereen ziet dezelfde deelnemers, raderen en uitslag. Kijkers kunnen niets aanpassen. De host kan deelnemers beheren, aantal kiezen, draaien, resetten en de sessie beëindigen. Live deelnemers worden niet naar browseropslag gekopieerd. De knop verschijnt alleen als een geldige publieke API-URL is geconfigureerd.

De sessie verloopt na acht uur. **Live beëindigen** wist de sessie eerder en laat beide links vervallen. Bewaar je hostlink voor jezelf: iedereen met die link kan de sessie bedienen. Deel alleen de kijklink. Deelbare toegang is geen volledige gebruikersauthenticatie.

De standaard aantalvoorkeur is 2, minimum 1 en maximum de deelnemerslijst. Bij verkleinen van de lijst wordt het effectieve aantal veilig begrensd. Elke bierhaler krijgt een eigen rad met dezelfde volledige pool. Eén gezamenlijke selectie bepaalt vooraf unieke winnaars. De raderen stoppen kort na elkaar; na de laatste volgt de finale. **Opnieuw draaien** kiest opnieuw uit de volledige pool; **Deelnemers aanpassen** wist alleen de trekking. Bediening is tijdens countdown/draaien vergrendeld.

Namen zijn maximaal 32 tekens, zonder dubbele namen ongeacht hoofdletters. Live sessies bevatten maximaal 100 deelnemers. Eén groot rad, twee/drie naast elkaar bij voldoende breedte, vier in 2×2 en meer in een responsive grid; op mobiel stapelen ze. Fullscreen en reduced motion blijven beschikbaar. Google Fonts is optioneel, met systeemlettertypen als terugval.

## Lokale ontwikkeling

Gebruik Node.js 22.12+ en npm. Voor standalone:

```sh
npm ci
npm run dev
```

Voor live, kopieer `.env.example` naar `.env.development.local` en start twee terminals:

```sh
# Terminal 1: lokale Worker + SQLite Durable Objects, poort 8787
npm run dev:worker
```

```sh
# Terminal 2: Vite, poort 5173
npm run dev
```

`.env.development.local` bevat uitsluitend publieke frontendconfiguratie:

```dotenv
VITE_API_URL=http://127.0.0.1:8787
```

Open `http://127.0.0.1:5173/`, start live en open de gekopieerde kijklink in twee andere browsers/vensters. Voeg acht synthetische deelnemers toe, kies drie bierhalers en draai. Ververs een kijker of open de link tijdens de trekking: de actuele voortgang/uitslag verschijnt. Opnieuw verbinden gebeurt automatisch met wachttijden van 1, 2, 4, 8, 16 en maximaal 30 seconden. Een onderbroken verbinding vergrendelt hostbediening tot de serverstand terug is.

De lokale Worker gebruikt `.wrangler/state`; dit is genegeerd door Git en bevat tijdelijke testdata. Gebruik uitsluitend synthetische deelnemers tijdens ontwikkeling. Geen productieverbinding of Cloudflare-login nodig voor lokaal testen. Laat VITE_API_URL weg om zelfstandig gebruik zonder backend te testen.

## Validatie

```sh
npm test                  # frontend/domein + echte workerd-integratietests
npm run typecheck
npm run typecheck:worker
npm run build
npm run build:worker       # dry-run, publiceert niets
npm run types:worker       # na wijzigingen aan bindings/configuratie
```

Er is geen linter geconfigureerd. `test:frontend` en `test:worker` kunnen apart draaien. Backendtests gebruiken dezelfde Miniflare-versie als Wrangler, via de officiële configuratieadapter. De test-only expiry-subclass wordt uitsluitend aan de in-memory testbundle toegevoegd en zit niet in productie.

## Architectuur

```text
ParticipantSource
       ↓
SessionController (Local of Remote)
       ↓
Draw Engine (Live: uitsluitend op de server)
       ↓
DrawInstruction
       ↓
SpinInstruction[]
       ↓
Dezelfde Wheel Renderers op elk scherm

PUBLIEK / ONBETROUWBAAR
GitHub Pages → React → RemoteSessionController
                         │ HTTPS / WSS
                  SECURITY BOUNDARY
                         ↓
                   Cloudflare Worker
                         ↓
                Durable Object per sessie
         autorisatie · tijdelijke SQLite-state
         Draw Engine · snapshots · alarms · expiry
```

- `src/domain` en `src/utils/random.ts`: gedeelde pure domeinlogica. Unbiased Fisher–Yates-sampling zonder teruglegging gebruikt `crypto.getRandomValues()` met rejection sampling. Elke deelnemer heeft dezelfde inclusiekans.
- `LocalSessionController`: lokale autoriteit en deadlines; alleen hier worden handmatige voorkeuren/opslag aangesloten.
- `RemoteSessionController`: HTTP-commando's, initiële snapshot, WebSocket, reconnect, klokcorrectie en verbindingstoestand. Geen lokale winnaarselectie of officiële statusovergangen.
- `shared/protocol.ts`: expliciete publieke DTO en netwerkberichten. Private servermodellen staan uitsluitend onder `worker/`.
- `worker/index.ts`: exacte Origin-allowlist, begrensde verzoeken, creatielimieten, capability-routing. Geen publieke sessielijst.
- `worker/live-session.ts`: geautoriseerde HTTP-acties en hibernerende WebSockets, SQLite-opslag, tijdgestuurde voortgang, verwijderen na afloop.
- `worker/session.ts`: strikte commando-validatie, rechten, veilige DTO, aantallen, selectie, deadlines.
- `WheelGrid`, `BeerWheel` en `useWheelAnimation`: uitsluitend deterministische weergave. De klokcontext levert alleen een tijdcorrectie en bevat geen netwerklogica.

De sessiestaten zijn `setup`, `ready`, `countdown`, `spinning`, `finished`. Geen speciale eerste/tweede winnaar. Eén DrawInstruction bevat alle spins, geordende volledige deelnemerspool en één starttijd. Elke spin bevat winnaar-ID, radindex, begin/eindrotatie, duur, omwentelingen en easing. Variatie ligt vooraf vast: zes/zeven rondes en 4,8–5,25 seconden.

### Timing en late kijkers

Lokaal is de aanloop 100 ms; live kiest de server `startAt = now + 2000 ms`. De controller schat het klokverschil via de servertimestamp en het midden van een HTTP/ping-roundtrip, met voorkeur voor de laagste gemeten latency per verbinding. Alle raderen rekenen met diezelfde correctie. Een lopende animatie wordt op de verstreken tijd in de oorspronkelijke easingcurve hervat; een voltooide instructie toont direct de eindstand.

Alarms bepalen server-side countdown, individuele onthullingen, finale en expiry. Een vertraagde alarmdelivery wordt bij volgende toegang ingehaald. De host hoeft niet verbonden te blijven. Na reconnect komt opnieuw een geautoriseerde volledige snapshot. Revisies verhinderen dat een oud HTTP-antwoord een nieuwere WebSocket-stand overschrijft of dat twee hosts stilzwijgend elkaars edits verliezen. Dit is visuele kantoorsynchronisatie; netwerklatency en achtergrondtab-throttling kunnen zichtbare verschillen geven.

## API en tijdelijke toegang

Productie vereist HTTPS/WSS. De frontendlinks gebruiken `#/host/<host>/<spectator>` en `#/live/<spectator>`, zodat statische Pages-routing werkt en de fragmenten niet naar GitHub worden gestuurd. Beide toegangscodes worden alleen bij creatie geretourneerd; de host kan na verversen opnieuw de kijklink kopiëren uit zijn eigen fragment. Er staat nooit een naam in een link.

Een capability bestaat uit een willekeurige 128-bit locator plus een onafhankelijke 256-bit secret. De locator is geen autorisatie of intern sessie-ID. De server bewaart SHA-256-hashes van beide secrets en vergelijkt timing-safe. Geen permanente directory of aparte database/KV-index is nodig.

| Operatie | Toegang | Gedrag |
| --- | --- | --- |
| `POST /api/sessions` met `{}` | Publiek, Origin + rate limits | Nieuwe sessie en eenmalige credentials |
| `GET /api/session` | Geldige host of kijker | Veilige snapshot, servertijd en rol |
| `POST /api/command` | Geldige host | Strikt getypeerd commando met actuele revisie |
| `GET /api/socket` upgrade | Geldige host of kijker | Snapshotupdates; alleen pingberichten toegestaan |

HTTP gebruikt `Authorization: Bearer <capability>`. Browsers bieden bij WebSocket-upgrade `bierrad, auth.<capability>` als subprotocol aan; de server selecteert alleen `bierrad`. Geen capabilities in backend-URLs of querystrings. Commando's: `setParticipants` (namen, server maakt IDs), `setWinnerCount`, `startDraw`, `reset`, `endSession`. De client kan nooit officiële winnaars/instructies aanleveren. Backendrechten zijn bepalend; frontendcapabilities zijn alleen UX.

Ongeldige/verlopen toegang retourneert dezelfde generieke unavailable-respons. Afloop wist namen/uitslag uit de UI, ook met een offline deadline. Bestaande sockets sluiten. De host kan de hele sessie onmiddellijk intrekken door haar te beëindigen.

Productiebackend: `https://bierrad-live.timzegveld.workers.dev`. De Pages-repositoryvariabele `VITE_API_URL` verwijst naar deze publieke origin.

## Cloudflare publiceren

```sh
npx wrangler login
npm run types:worker
npm test
npm run typecheck:worker
npm run build:worker
npm run deploy:worker
```

De top-level `wrangler.jsonc` is productie, `development` alleen lokaal. De eerste deploy maakt de SQLite Durable Object-namespace via migratie `v1`. Voor handmatige live-sessies is geen runtimecredential nodig. Optionele Slack-sessies vereisen uitsluitend serversecrets; zie [Slack instellen](docs/slack-setup.md). Cloudflare-deploycredentials blijven bij Wrangler/secretbeheer en gaan nooit de frontend in. Kies binnen je Cloudflare-account unieke rate-limit namespace-nummers als andere Workers de ingestelde nummers al gebruiken.

Na deploy: zet de repositoryvariabele `VITE_API_URL` op de publieke HTTPS Worker-origin. De bestaande Pages-workflow gebruikt alleen deze publieke variabele. Een push naar `main` valideert frontend én backend en publiceert `dist` als `ENABLE_PAGES=true`. De Worker wordt bewust apart met Wrangler gepubliceerd; Pages CI krijgt geen Cloudflare-credentials. Deploy compatibele backendwijzigingen vóór het frontend.

Productie staat alleen `https://timzegveld.github.io` als Origin toe. Lokale configuratie staat `http://127.0.0.1:5173` en `http://localhost:5173` toe. Dit is geen authmechanisme: ook met een vervalste Origin blijft een geldige capability vereist. Vite gebruikt `base: './'`, fragmentroutes en een buildspecifieke CSP zodat `/bierrad/` op GitHub Pages blijft werken.

## Beveiliging en beperkingen

[SECURITY.md](SECURITY.md) is bindend. [De implementatiereview](docs/live-security-review.md) beschrijft controles, tests en beperkingen. GitHub, frontend en browser zijn publiek/onbetrouwbaar; credentials en autoriteit horen op de backend. Private API-responses zijn no-store/noindex/no-referrer. De statische frontend gebruikt no-referrer/noindex-meta en een CSP. Pages ondersteunt hier geen HTTP-headerbeleid per fragmentroute. Geen analytics. Nooit headers, body, capability-links of deelnemers loggen; observability staat uit.

Creatie is begrensd tot 5/minuut per IP en 60/minuut per Cloudflare-locatie. Verzoeken/upgrades: 240/minuut per IP. Een sessie heeft maximaal 64 sockets, 60 mutaties/minuut en 6 trekkingen/minuut; sockets alleen 12 korte berichten/minuut. Dit beperkt eenvoudig misbruik, maar is geen globale quota/botpreventie: verspreid misbruik blijft mogelijk en kantoor-IP's delen hun limiet. Sterkere creatie-autorisatie kan later vóór de creatiebranch worden toegevoegd. Controleer kosten en alerts bij bredere inzet.

Tijdelijke toegang is niet hetzelfde als gebruikersauthenticatie. Links kunnen in browsergeschiedenis of het bewust gebruikte klembord staan. Wie een link bezit kan diens rechten gebruiken tot afloop/beëindiging. De server verwijdert applicatiestate; onderliggende providerbackups hebben hun eigen bewaarbeleid. Authorized clients ontvangen de vooraf gekozen winnaars in de instructie en kunnen die technisch vóór de onthulling inspecteren.

## Later

Automatische geplande trekkingen zijn niet geïmplementeerd. Een toekomstige scheduler roept dezelfde server-drawoperatie aan. Er is geen permanente medewerkerhistorie.


## Slack-deelnemers en threaduitslag

Een bevoegde organisator kan via een **privé-startlink** een Slack-sessie openen. Een gewone publieke host heeft geen Slack-toegang. Kies Slack, plak een berichtlink en haal de `:beers:`-reactors op. Refresh volgt de reacties en behoudt handmatige toevoegingen; gelijke namen krijgen onderscheidende labels met stabiele tijdelijke IDs. Na de trekking post de server de officiële winnaars automatisch in de oorspronkelijke thread, ook als de host gesloten is. Fouten veranderen de uitslag niet; alleen zeker afgewezen posts kunnen gecontroleerd opnieuw worden aangeboden. Bij onzekere aflevering voorkomt Bierrad herverzending.

[Appmanifest en veilige instelling](docs/slack-setup.md) · [Security review en tien antwoorden](docs/slack-security-review.md)

```text
Privé-startcapability → geautoriseerde tijdelijke Slack-sessie
SlackReactionParticipantSource (alleen server)
          ↓ veilige sessie-ID's + namen
SessionController → Draw Engine → DrawInstruction → Wheel Renderers
                          ↓ na alle spins, via durable alarm
                  officiële uitslag → oorspronkelijke Slack-thread
```

`worker/slack` bevat de getypeerde client, parser, deelnemersbron, private mapping en resultaattekst. `POST /api/slack-sessions` vereist de aparte startcapability in Authorization; overige hostcommando's zijn `slackImport` (optioneel permalink, zonder link = refresh), `slackManual`, `slackRetry`. Ook gemanipuleerde spectatorrequests worden afgewezen. Spectator-DTO's bevatten geen Slack-metadata. De raderen/selectie zijn ongewijzigd en blijven zonder netwerk of Slack functioneren.
