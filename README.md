# 🍻 Bierrad 🎡

Wie haalt deze week het bier? Voeg deelnemers toe, kies het aantal bierhalers en laat hun raderen tegelijk draaien. Warm, speels en Nederlands. **Geen discussie. Gewoon draaien.**

[Open Bierrad](https://timzegveld.github.io/bierrad/) · [Productvisie](vision.md) · [Verplichte beveiligingsregels](SECURITY.md) · [Agentinstructies](AGENTS.md)

## Lokaal of live

**Alleen op dit scherm** werkt zelfstandig, zonder backend, account of netwerk. Een persoonlijk bier- of koffierad begint bij openen of verversen leeg, met de standaardvoorkeur van twee halers en zonder aangepaste winkansen. Eerdere handmatig ingevoerde deelnemers kun je bewust herstellen via de herstelknop; ze worden nooit automatisch geladen. Live-raden laden via hun eigen link de bestaande sessiestand. Iedere trekking is onafhankelijk: eerdere winnaars mogen opnieuw winnen.

**Start live Bierrad** maakt een nieuwe, lege tijdelijke sessie. Je wordt host, voert deelnemers in en deelt **Kopieer kijklink** met collega's of de kantoor-tv. Iedereen ziet dezelfde deelnemers, raderen en uitslag. Kijkers kunnen niets aanpassen. De host kan deelnemers beheren, aantal kiezen, draaien, resetten en de sessie beëindigen. Live deelnemers worden niet naar browseropslag gekopieerd. De knop verschijnt alleen als een geldige publieke API-URL is geconfigureerd.

De kijklink opent een presentatiescherm voor monitor of kantoor-tv: zo groot mogelijke raderen, een inklapbare deelnemerslijst, een gezamenlijke 3-2-1 op de starttijd van de server, per rad de winnaar zodra dat rad stopt en daarna de gezamenlijke uitslag tot de host reset. Het scherm leidt alles af uit de serverstand; wie later instapt of herlaadt, ziet direct de juiste fase.

Een nieuwe sessie verloopt standaard na 24 uur (of eerder als de Slack-toegang verloopt). Een latere automatische start verlengt een nog geldige sessie zo nodig tot één uur na die start. **Live beëindigen** wist de sessie eerder en laat beide links vervallen. Bewaar je hostlink voor jezelf: iedereen met die link kan de sessie bedienen. Deel alleen de kijklink. Deelbare toegang is geen volledige gebruikersauthenticatie.

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

### Demo: Koffierad met nep-Slack

```sh
npm run demo
```

Eén commando, zonder Slack-app of secrets: bouwt de Worker, draait hem in Miniflare met een nep-Slack ervoor (poort 8787) en start Vite (poort 5173). Open `http://127.0.0.1:8787/__demo/`. Daar staat een nep-Slack-kanaal met een koffieoproep van zes verzonnen collega's. Klik op **Open de ronde**, log in via de nep-inlogpagina als een van de zes, zie het rad 10 seconden aftellen en draaien, en stem daarna. Knoppen op de demopagina slaan de wachtminuut voor het stemmen over, laten de anderen stemmen of starten een nieuwe ronde. De reviews verschijnen in de nep-thread. Alles staat in het geheugen; herstarten wist alles. De tijdhooks (`DemoSession`, `DemoChannel`) worden uitsluitend aan de in-memory demobundle toegevoegd en zitten niet in productie. Stop eerst een lopende `dev:worker` of `dev`, want de demo gebruikt dezelfde poorten.

`npm run demo:bier` doet hetzelfde voor het Bierrad: de bot plaatst een `/bierrad` over een kwartier met een eigen tekst, je klikt op **radje**, logt in, en bij het aftellen verschijnt de herinnering met **Inloggen** en **alleen meekijken** in de thread. Daarna draait het rad met twee halers.

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

De sessiestaten zijn `setup`, `ready`, `countdown`, `spinning`, `finished`. Geen speciale eerste/tweede winnaar. Eén DrawInstruction bevat alle spins, geordende volledige deelnemerspool en één starttijd. Elke spin bevat winnaar-ID, radindex, begin/eindrotatie, duur, omwentelingen en easing. Variatie ligt vooraf vast: zes/zeven rondes en 6,5–6,95 seconden, met een lang, traag uitrollend einde. Het rad stopt op een gelijk verdeelde willekeurige plek binnen het vak van de winnaar (minstens 8% en 2° van elke grens), zodat het soms net over een grens gaat en soms er net voor blijft. Die plek wordt pas na de winnaarskeuze getrokken, is alleen visueel en zit al in de eindrotatie die elk scherm krijgt.

### Timing en late kijkers

Lokaal is de aanloop 100 ms; live kiest de server `startAt = now + 4000 ms`, zodat elk scherm een gelijklopende 3-2-1 kan tonen. De controller schat het klokverschil via de servertimestamp en het midden van een HTTP/ping-roundtrip, met voorkeur voor de laagste gemeten latency per verbinding. Alle raderen rekenen met diezelfde correctie. Een lopende animatie wordt op de verstreken tijd in de oorspronkelijke easingcurve hervat; een voltooide instructie toont direct de eindstand.

Alarms bepalen server-side countdown, individuele onthullingen, finale en expiry. Een vertraagde alarmdelivery wordt bij volgende toegang ingehaald. De host hoeft niet verbonden te blijven. Na reconnect komt opnieuw een geautoriseerde volledige snapshot. Revisies verhinderen dat een oud HTTP-antwoord een nieuwere WebSocket-stand overschrijft of dat twee hosts stilzwijgend elkaars edits verliezen. Dit is visuele kantoorsynchronisatie; netwerklatency en achtergrondtab-throttling kunnen zichtbare verschillen geven.

## API en tijdelijke toegang

Productie vereist HTTPS/WSS. De frontendlinks gebruiken `#/host/<host>/<spectator>` en `#/live/<spectator>`, zodat statische Pages-routing werkt en de fragmenten niet naar GitHub worden gestuurd. Beide toegangscodes worden alleen bij creatie geretourneerd; de host kan na verversen opnieuw de kijklink kopiëren uit zijn eigen fragment. Er staat nooit een naam in een link.

Een hostcapability bestaat uit een willekeurige 128-bit locator plus een onafhankelijke 256-bit secret. De locator is geen autorisatie of intern sessie-ID. Een kijklink gebruikt 5 aan elkaar gekoppelde woorden uit een vaste lijst van 1024 korte Nederlandse woorden (50 willekeurige bits; bewust minder dan de 128 bits van de hostlink, omdat kijkers alleen meekijken), bijvoorbeeld `#/live/kaas-molen-tulp-…`, zodat je hem makkelijker overtypt of voorleest. De server leidt de locator daarvan eenrichtings af (SHA-256 met eigen domeinprefix). Oudere hexadecimale en 13-woords kijklinks blijven werken tot hun sessie afloopt. De server bewaart SHA-256-hashes van beide secrets en vergelijkt timing-safe. Geen permanente directory of aparte database/KV-index is nodig.

| Operatie | Toegang | Gedrag |
| --- | --- | --- |
| `POST /api/sessions` met `{}` | Publiek, Origin + rate limits | Nieuwe sessie en eenmalige credentials |
| `GET /api/session` | Geldige host of kijker | Veilige snapshot, servertijd en rol |
| `POST /api/command` | Geldige host | Strikt getypeerd commando met actuele revisie |
| `GET /api/socket` upgrade | Geldige host of kijker | Snapshotupdates; alleen pingberichten toegestaan |
| `GET /api/channel` | Geldige beheer- of aanvraaglink van een kanaal-Koffierad | Status, standaardwachttijd en lopende ronde |
| `POST /api/channel` | Idem; beheer alleen met beheerlink | `setDefaultMinutes`, `setReviews`, `rotateRequestLink`, `unbind`; met een persoonlijke link `review` en `logout`. Rondes starten alleen met `/koffierad`, `/waterrad` of `/koekrad`. |
| `POST /slack/commands` | Uitsluitend met geldige handtekening van de Koffierad-app | `/koffierad [minuten]`, `/waterrad [minuten]` of `/koekrad [titel] [minuten]` start een koffie-, water- of koekronde in het gekoppelde kanaal |
| `POST /slack/bier-commands` | Uitsluitend met geldige handtekening van de Bierrad-app | `/bierrad [dag] [tijd] [aantal] [tekst]` plant een bierronde in het gekoppelde kanaal |

HTTP gebruikt `Authorization: Bearer <capability>`. Browsers bieden bij WebSocket-upgrade `bierrad, auth.<capability>` als subprotocol aan; de server selecteert alleen `bierrad`. Geen capabilities in backend-URLs of querystrings. Commando's: `setParticipants` (namen, server maakt IDs), `setWinnerCount`, `setScheduledDraw` (ISO-tijd of null om te annuleren, optioneel met `spectatorCapability` om de kijklink vooraf in de Slack-thread te laten plaatsen), `startDraw`, `reset`, `endSession`. De client kan nooit officiële winnaars/instructies aanleveren. Backendrechten zijn bepalend; frontendcapabilities zijn alleen UX.

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

[SECURITY.md](SECURITY.md) is bindend. [De implementatiereview](docs/live-security-review.md) beschrijft controles, tests en beperkingen. GitHub, frontend en browser zijn publiek/onbetrouwbaar; credentials en autoriteit horen op de backend. Private API-responses zijn no-store/noindex/no-referrer. De statische frontend gebruikt een `strict-origin`-referrerbeleid, noindex-meta en een CSP. `strict-origin` stuurt hooguit de origin (`https://timzegveld.github.io`), nooit pad of fragment; capabilities staan alleen in het fragment en lekken dus niet via een Referer. `no-referrer` kan niet: dan sturen browsers bij de loginformulieren `Origin: null` mee en weigert de backend elke login. Pages ondersteunt hier geen HTTP-headerbeleid per fragmentroute. Geen analytics. Nooit headers, body, capability-links of deelnemers loggen; observability staat uit.

Creatie is begrensd tot 5/minuut per IP en 60/minuut per Cloudflare-locatie. Verzoeken/upgrades: 240/minuut per IP. Een sessie heeft maximaal 64 sockets, 60 mutaties/minuut en 6 trekkingen/minuut; sockets alleen 12 korte berichten/minuut. Dit beperkt eenvoudig misbruik, maar is geen globale quota/botpreventie: verspreid misbruik blijft mogelijk en kantoor-IP's delen hun limiet. Sterkere creatie-autorisatie kan later vóór de creatiebranch worden toegevoegd. Controleer kosten en alerts bij bredere inzet.

Tijdelijke toegang is niet hetzelfde als gebruikersauthenticatie. Links kunnen in browsergeschiedenis of het bewust gebruikte klembord staan. Wie een link bezit kan diens rechten gebruiken tot afloop/beëindiging. De server verwijdert applicatiestate; onderliggende providerbackups hebben hun eigen bewaarbeleid. Authorized clients ontvangen de vooraf gekozen winnaars in de instructie en kunnen die technisch vóór de onthulling inspecteren.

## Later

Wekelijks herhalende planning en automatische kanaaloproepen zijn niet geïmplementeerd. Er is geen permanente medewerkerhistorie.


## Automatisch starten

Een live-host kan onder **Automatisch starten** een datum en tijd kiezen, standaard de eerstvolgende vrijdag om **15.45 Nederlandse tijd (Europe/Amsterdam)**. Zet de start expliciet aan; uitzetten annuleert de planning. Dit is één trekking, geen wekelijkse herhaling. Je kunt tot 30 dagen vooruit plannen. Een nog geldige sessie wordt zo nodig verlengd tot één uur na de start; een eerdere planning verkort de bestaande geldigheid niet. Een verlopen sessie kan niet worden heropend. Annuleren of handmatig draaien draait een toegekende verlenging niet terug. De planning blijft bij herladen behouden en de server start ook zonder open hostscherm. Handmatig draaien of resetten annuleert de planning. Bij een lege lijst, een bezette sessie of meer dan een minuut te late alarmbezorging wordt de start overgeslagen; de host kan opnieuw plannen.

## Slack

Slack-deelname loopt uitsluitend via een aan een kanaal gekoppeld rad: het Bierrad met `/bierrad` (hieronder) en het [Koffierad](#live-koffierad-per-slack-kanaal). **Start met Slack** (een vrijdagbericht van een collega koppelen) is op 2026-10-07 verwijderd, met de bijbehorende deelnamelinks (`#/meedoen/…`). Oude links naar `#/slack` en `#/meedoen/…` openen het lokale Bierrad; sessies die zo gestart zijn houden geen Slack-toegang meer.

### Bierrad per Slack-kanaal: `/bierrad`

Koppel het Bierrad aan een kanaal via `#/bier-koppelen` (met de eigen Bierrad-app). Daarna typt iedereen in dat kanaal `/bierrad`: de bot plaatst de vaste oproep (":beers: :spin-the-wheel: Het bierronde radje …") met een 🍻 eronder, en het rad draait vandaag om **15:45** met **twee** halers. Kies zelf met bijvoorbeeld `/bierrad 15.44`, `/bierrad morgen`, `/bierrad vrijdag 16.00 3` of `/bierrad 10-10 16.30`; een tijd die al geweest is, wordt geweigerd. Alles na dag, tijd en aantal is je eigen tekst boven de oproep (emoji en `*vet*` mogen; mentions en links blijven gewone tekst).

"radje" in de oproep opent het vaste rad van het kanaal (`#/bier/…`), waar je **inlogt met Slack** of **alleen meekijkt**. Twee minuten voor de start zet de bot beide links nog eens in de thread. Na de trekking staan de halers met @vermelding in de thread en in de bijgewerkte oproep; deelnemers geven ze daarna anoniem 1–5 sterren (standaard 30 minuten). Op de beheerpagina stel je het standaard aantal halers en de reviews in. Zie [Bierrad instellen](docs/slack-setup.md#bierrad-app-bierrad-in-een-kanaal).

[Appmanifest en veilige instelling](docs/slack-setup.md) · [Security review](docs/slack-security-review.md)

`worker/slack` bevat de getypeerde client, deelnemersbron, private mapping en resultaattekst; `worker/slack/login.ts` doet Sign in with Slack, alleen om een kanaal te koppelen of voor een persoonlijke kanaallink. De raderen/selectie zijn ongewijzigd en blijven zonder netwerk of Slack functioneren.

## Koffierad ☕

Naast Bierrad is er **Koffierad: wie haalt de volgende koffie?** Kies bovenaan je variant of open de site met `#/coffee` (bier: `#/beer`; de bestaande lege route blijft Bierrad). Beide gebruiken dezelfde radlogica. Koffie heeft warme crème-/espressokleuren en eigen teksten en een apart opgeslagen deelnemerslijst voor handmatig herstel. Beide varianten starten leeg met de standaard aantalvoorkeur. Wisselen start een lokale variant; tijdens draaien is de wissel geblokkeerd. Er is geen permanente uitslaghistorie.

De variant van een live-sessie staat vanaf creatie vast op de server; host en kijkers ontvangen hetzelfde thema. Oude sessies en links blijven bier. `POST /api/sessions` accepteert `{}` voor bier of een body met uitsluitend `variant`, met waarde `beer` of `coffee`. Koffie krijgt een **eigen Slack-app** met eigen servercredentials, `:coffee:`-reacties en koffie-uitslagen, uitsluitend via [een gekoppeld kanaal](#live-koffierad-per-slack-kanaal) en `/koffierad`. Oude links naar `#/coffee-slack` openen het Koffierad. Zie [Koffierad instellen](docs/slack-setup.md#aparte-koffierad-app).

### Live Koffierad per Slack-kanaal

Iedere afdeling kan een eigen Koffierad aan een eigen Slack-kanaal koppelen via `#/koffie-koppelen` (inloggen met Slack, daarna plaatst de bot een bevestiging in het kanaal). De vaste kanaallink (`#/koffie/<link>`) is het rad van dat kanaal: hij toont steeds het live rad en de uitslag van de laatste ronde. Een minuut na de finale maakt het rad plaats voor een rustige uitslagpagina ("De koffieronde is gedraaid"; bij de Bierrad "De bierronde van vandaag is gedraaid") met de halers, de stemvoortgang en, zodra het stemmen voorbij is, per haler de sterren en **🎡 Bekijk het rad nog eens**, dat de trekking lokaal opnieuw afspeelt vanuit de bevroren draaiinstructie; tot een half uur na de start, daarna volgt weer de uitleg. Daarna kan **iedereen** een koffieronde aanvragen door in het kanaal `/koffierad` of `/koffierad 10` te typen; de kanaalpagina zelf heeft geen startknoppen. De aanvrager kiest binnen hoeveel minuten het rad draait (standaard 5); de start valt op de volgende hele minuut, zodat de getoonde tijd klopt, en kijkers zien een afteller. De bot plaatst een oproep in het kanaal en zet er zelf al een ☕-reactie onder, zodat meedoen één klik is; die botreactie telt nooit mee. Kijkers zien het rad vollopen. Na de wachttijd draait het rad op de server en kiest het precies één koffiehaler. De bot meldt die met @vermelding in de thread van de oproep en werkt de oproep zelf bij tot "🏆 @naam haalt koffie", zodat het kanaal één bericht per ronde houdt. Doet niemand mee, dan staat dat in de bijgewerkte oproep. Voor een extern scherm kopieert **🖥 Op ander scherm tonen** op de kanaalpagina een meekijklink in woorden (`#/koffie/aap-beer-…`, makkelijk over te typen): die toont steeds het rad en de uitslag van de laatste ronde, maar kan geen rondes starten of iets beheren. De beheerlink (`#/koffie-beheer/…`) kan de standaardwachttijd aanpassen, een nieuwe aanvraaglink maken (dat vervangt ook de meekijklink) en ontkoppelen. Zie [kanaal koppelen](docs/slack-setup.md#koffierad-aan-een-kanaal-koppelen) en de [securityreview](docs/channel-security-review.md).

**Reviews (koffie, water en koek).** Staan reviews aan (standaard aan, ook voor bestaande kanalen; uit te zetten op de beheerpagina), dan linkt de oproep naar de kanaalpagina met **Inloggen met Slack** of **Alleen kijken**. Inloggen geeft een persoonlijke link (30 dagen, als bladwijzer te bewaren) waarmee je meekijkt en na afloop de haler 1–5 sterren geeft, met optioneel een anonieme tekst. Alleen deelnemers van die ronde stemmen, één keer, nooit op zichzelf. Als iedereen gestemd heeft of de tijd om is (standaard 15 minuten), plaatst de bot de reviews anoniem in de thread, met een eigen bericht per haler (zo kun je per haler een emoji-reactie geven), en werkt hij de oproep bij met de sterren. De sterren staan daarna ook op de uitslagpagina van de ronde; de teksten alleen in Slack. Daarna worden de stemmen en teksten gewist; de sterren verdwijnen met de ronde, een uur na de start. Zie [reviews-review](docs/reviews-review.md).

## Waterrad 💧

Het derde rad: **wie haalt het water voor de afdeling?** Het Waterrad bestaat alleen als ronde van een aan een kanaal gekoppeld Koffierad: typ `/waterrad` (of `/waterrad 10`) in het kanaal. Het staat niet in de wissel bovenaan, er is geen lokaal Waterrad en geen Start met Slack; oude links naar `#/water` en `#/water-slack` openen het Koffierad, en `POST /api/sessions` weigert `variant: "water"`. Een waterronde heeft blauwe/aqua kleuren, een eigen icoon en eigen teksten ("Rondje gemeentepils van de zaak! Hydrateer ons trots."), gebruikt bewust **dezelfde Slack-app als koffie** (geen nieuwe app of secrets) en telt uitsluitend **💧 `:droplet:`**-reacties.

 Het is dezelfde koppeling met dezelfde links; het vaste kanaalrad en de meekijklink kleuren automatisch mee met de ronde (blauw bij water, bruin bij koffie). Per kanaal loopt één ronde tegelijk, koffie of water, met samen maximaal 25 per 24 uur. Zie [waterrondes toevoegen](docs/slack-setup.md#waterrondes-toevoegen-waterrad).

## Koekrad 🍪

Het vierde rad: **wie haalt de koek, taart of bitterballen?** Net als het Waterrad bestaat het Koekrad alleen als ronde van een aan een kanaal gekoppeld Koffierad, met dezelfde app, koppeling, links, reviews en daglimiet. Typ `/koekrad` in het kanaal, of geef de ronde een titel van één woord: `/koekrad taart 5` start over vijf minuten een **Taartronde** met een **Taartrad** en een taarthaler. Zonder titel heet het gewoon Koekrad. De titel is één woord van 2 tot 20 letters (ook met accenten, en een koppelteken mag); al het andere geeft de uitleg. Collega's doen mee met **🍪 `:cookie:`**. De titel hoort bij die ene ronde en verdwijnt daarna; een stilstaand kanaalscherm toont weer het gewone Koekrad. Zie [koekrondes toevoegen](docs/slack-setup.md#koekrondes-toevoegen-koekrad) en de [securityreview](docs/channel-security-review.md).

Bij een Koekrad maakt iedere menselijke reactie met `:naam-koek:` het vak van die naam groter, bijvoorbeeld `:alice-koek:`. Alice krijgt dan één extra lot: haar vak is twee keer zo groot en ze heeft twee keer zoveel kans. Vier mensen met `:alice-koek:` geven haar vak vijf loten. Het telt alleen als precies één 🍪-deelnemer exact zo heet (hoofdletters maken niet uit); ontbreekt de naam of komt hij twee keer voor, dan doet de reactie niets. Een koekemoji meldt niemand aan, ook de plaatser niet, en geeft geen extra reviewstem. Verwijderen van de reactie maakt het vak bij de volgende controle weer kleiner. Voor een volledige naam gebruik je underscores, bijvoorbeeld `:alice_bakker-koek:` voor `Alice Bakker`.

Wint Alice, dan kiest de server tegelijk met de trekking één van haar loten. Was dat een koekemoji, dan zet hij **Mede mogelijk gemaakt door... @degene die reageerde** in de threaduitslag; was het haar eigen 🍪, dan niet. Bier-, koffie- en waterreacties veranderen niet.

## Linkvoorbeelden

De statische HTML bevat Open Graph- en Twitter Card-metadata met een vaste publieke afbeelding: `public/social-preview.png` (1730 × 909). Alle fragmentroutes, inclusief live- en koffielinks, gebruiken dezelfde Bierrad-preview. De afbeelding bevat geen deelnemers, uitslagen of toegangscodes en vereist geen backendverzoek. De bestaande privacy-meta en CSP blijven behouden.

Bij een verhuizing naar een ander domein of subpad moeten de absolute `og:url`, `og:image` en `twitter:image`-adressen in `index.html` worden aangepast. Controleer na publicatie dat de PNG publiek bereikbaar is en deel de link opnieuw in de gewenste chatapp. Chatapps bepalen zelf uitsnede en weergave en kunnen eerdere previews cachen; bestaande berichten verversen niet noodzakelijk direct. Gebruik bij externe previewvalidators uitsluitend de publieke basis-URL, nooit een live- of hostlink.
