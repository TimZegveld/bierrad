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
| `POST /api/channel` | Idem; beheer alleen met beheerlink | `requestRound` (1–30 minuten), `setDefaultMinutes`, `rotateRequestLink`, `unbind` |
| `POST /slack/commands` | Uitsluitend met geldige Slack-handtekening | `/koffierad [minuten]` of `/waterrad [minuten]` start een koffie- of waterronde in het gekoppelde kanaal |

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

[SECURITY.md](SECURITY.md) is bindend. [De implementatiereview](docs/live-security-review.md) beschrijft controles, tests en beperkingen. GitHub, frontend en browser zijn publiek/onbetrouwbaar; credentials en autoriteit horen op de backend. Private API-responses zijn no-store/noindex/no-referrer. De statische frontend gebruikt no-referrer/noindex-meta en een CSP. Pages ondersteunt hier geen HTTP-headerbeleid per fragmentroute. Geen analytics. Nooit headers, body, capability-links of deelnemers loggen; observability staat uit.

Creatie is begrensd tot 5/minuut per IP en 60/minuut per Cloudflare-locatie. Verzoeken/upgrades: 240/minuut per IP. Een sessie heeft maximaal 64 sockets, 60 mutaties/minuut en 6 trekkingen/minuut; sockets alleen 12 korte berichten/minuut. Dit beperkt eenvoudig misbruik, maar is geen globale quota/botpreventie: verspreid misbruik blijft mogelijk en kantoor-IP's delen hun limiet. Sterkere creatie-autorisatie kan later vóór de creatiebranch worden toegevoegd. Controleer kosten en alerts bij bredere inzet.

Tijdelijke toegang is niet hetzelfde als gebruikersauthenticatie. Links kunnen in browsergeschiedenis of het bewust gebruikte klembord staan. Wie een link bezit kan diens rechten gebruiken tot afloop/beëindiging. De server verwijdert applicatiestate; onderliggende providerbackups hebben hun eigen bewaarbeleid. Authorized clients ontvangen de vooraf gekozen winnaars in de instructie en kunnen die technisch vóór de onthulling inspecteren.

## Later

Wekelijks herhalende planning en automatische kanaaloproepen zijn niet geïmplementeerd; alleen de optionele kijklink-herinnering in de bestaande thread. Er is geen permanente medewerkerhistorie.


## Automatisch verversen en starten

Na Slack-import kun je **Automatisch verversen · elke 5 minuten** aanvinken. Dit werkt zolang dit hostscherm openstaat; sluiten of herladen zet de schakelaar uit. Het pauzeert bij verbroken verbinding, tijdens een import/trekking en vanaf twee minuten voor een geplande start. Handmatige toevoegingen blijven behouden.

Een live-host kan onder **Automatisch starten** een datum en tijd kiezen, standaard de eerstvolgende vrijdag om **15.45 Nederlandse tijd (Europe/Amsterdam)**. Zet de start expliciet aan; uitzetten annuleert de planning. Dit is één trekking, geen wekelijkse herhaling. Je kunt tot 30 dagen vooruit plannen. Een nog geldige sessie wordt zo nodig verlengd tot één uur na de start; een eerdere planning verkort de bestaande geldigheid niet. De Slack-toegang moet tot die tijd geldig zijn. Een verlopen sessie kan niet worden heropend. Annuleren of handmatig draaien draait een toegekende verlenging niet terug. De planning blijft bij herladen behouden en de server start ook zonder open hostscherm. Handmatig draaien of resetten annuleert de planning.

Bij een Slack-sessie staat bij het plannen **Stuur 2 minuten vooraf de kijklink in de Slack-thread** standaard aan. De server plaatst dan twee minuten voor de start (of meteen, als de start dichterbij ligt maar nog minstens 30 seconden weg is) een kort bericht met de kijklink in de oorspronkelijke thread, zodat collega's op tijd kunnen meekijken. Iedereen die die thread kan lezen kan daarna tot het einde van de sessie meekijken. Dit werkt alleen vanuit de volledige hostlink, omdat alleen die de kijklink bevat. De server controleert de link tegen de opgeslagen hash, bouwt de URL zelf op uit `FRONTEND_URL` en bewaart de ruwe kijklink alleen tot het bericht is geplaatst of de planning verandert.

Vlak vóór de automatische trekking controleert de server de Slack-reacties nogmaals, ook als de vijfminutenrefresh uitstaat. Daarna kiest dezelfde server-drawoperatie de winnaars en publiceert de normale threaduitslag. De laatste controle kan de daadwerkelijke start iets vertragen. Bij ophaalfouten, verlopen Slack-toegang, een lege lijst, een bezette sessie of meer dan een minuut te late alarmbezorging wordt de start overgeslagen; de host kan opnieuw plannen. Er wordt niet stilzwijgend met een oude lijst gedraaid. Bij een crash tijdens de eindcontrole vervalt de poging uiterlijk na twee minuten. Standalone blijft handmatig werken.

## Slack-deelnemers en threaduitslag

Een volwaardig lid van de Slack-workspace start een Slack-sessie met **Start met Slack** (Sign in with Slack). Een gewone publieke host, gast of externe gebruiker heeft geen Slack-starttoegang. Kies Slack, plak een berichtlink en haal de `:beers:`-reactors op. Refresh volgt de reacties en behoudt handmatige toevoegingen; gelijke namen krijgen onderscheidende labels met stabiele tijdelijke IDs. Na de trekking post de server de officiële winnaars automatisch in de oorspronkelijke thread, ook als de host gesloten is. Geïmporteerde Slack-winnaars krijgen een echte @vermelding; handmatige deelnemers blijven gewone tekst. Fouten veranderen de uitslag niet; alleen zeker afgewezen posts kunnen gecontroleerd opnieuw worden aangeboden. Bij onzekere aflevering voorkomt Bierrad herverzending.

[Appmanifest en veilige instelling](docs/slack-setup.md) · [Security review en tien antwoorden](docs/slack-security-review.md)

```text
Sign in with Slack (alleen server) → geautoriseerde tijdelijke Slack-sessie
SlackReactionParticipantSource (alleen server)
          ↓ veilige sessie-ID's + namen
SessionController → Draw Engine → DrawInstruction → Wheel Renderers
                          ↓ na alle spins, via durable alarm
                  officiële uitslag → oorspronkelijke Slack-thread
```

`worker/slack` bevat de getypeerde client, parser, deelnemersbron, private mapping en resultaattekst. `worker/slack/login.ts` doet de inlogflow via `GET /auth/slack/<beer|coffee|water>` en `GET /auth/slack/callback`; hostcommando's zijn `slackImport` (optioneel permalink, zonder link = refresh), `slackManual`, `slackRetry`. Ook gemanipuleerde spectatorrequests worden afgewezen. Spectator-DTO's bevatten geen Slack-metadata. De raderen/selectie zijn ongewijzigd en blijven zonder netwerk of Slack functioneren.

## Koffierad ☕

Naast Bierrad is er **Koffierad: wie haalt de volgende koffie?** Kies bovenaan je variant of open de site met `#/coffee` (bier: `#/beer`; de bestaande lege route blijft Bierrad). Beide gebruiken dezelfde radlogica. Koffie heeft warme crème-/espressokleuren en eigen teksten en een apart opgeslagen deelnemerslijst voor handmatig herstel. Beide varianten starten leeg met de standaard aantalvoorkeur. Wisselen start een lokale variant; tijdens draaien is de wissel geblokkeerd. Er is geen permanente uitslaghistorie.

De variant van een live-sessie staat vanaf creatie vast op de server; host en kijkers ontvangen hetzelfde thema. Oude sessies en links blijven bier. `POST /api/sessions` accepteert `{}` voor bier of een body met uitsluitend `variant`, met waarde `beer` of `coffee`. Koffie krijgt een **eigen Slack-app** met eigen servercredentials, eigen inloggen, `:coffee:`-reacties en koffie-uitslagen. Zie [Koffierad instellen](docs/slack-setup.md#aparte-koffierad-app).

### Live Koffierad per Slack-kanaal

Iedere afdeling kan een eigen Koffierad aan een eigen Slack-kanaal koppelen via `#/koffie-koppelen` (inloggen met Slack, daarna plaatst de bot een bevestiging in het kanaal). De vaste kanaallink (`#/koffie/<link>`) is het rad van dat kanaal: hij toont steeds het live rad en de uitslag van de laatste ronde. Daarna kan **iedereen** een koffieronde aanvragen: op die pagina of door in het kanaal `/koffierad` of `/koffierad 10` te typen. De aanvrager kiest binnen hoeveel minuten het rad draait (standaard 5); de start valt op de volgende hele minuut, zodat de getoonde tijd klopt, en kijkers zien een afteller. De bot plaatst een oproep in het kanaal en zet er zelf al een ☕-reactie onder, zodat meedoen één klik is; die botreactie telt nooit mee. Kijkers zien het rad vollopen. Na de wachttijd draait het rad op de server, kiest het precies één koffiehaler en meldt de bot die in de thread van de oproep, en ook in het kanaal. Doet niemand mee, dan staat dat in de thread. Voor een extern scherm toont de kanaalpagina ook een meekijklink in woorden (`#/koffie/aap-beer-…`, makkelijk over te typen): die toont steeds het rad en de uitslag van de laatste ronde, maar kan geen rondes starten of iets beheren. De beheerlink (`#/koffie-beheer/…`) kan de standaardwachttijd aanpassen, een nieuwe aanvraaglink maken (dat vervangt ook de meekijklink) en ontkoppelen. Zie [kanaal koppelen](docs/slack-setup.md#koffierad-aan-een-kanaal-koppelen) en de [securityreview](docs/channel-security-review.md).

## Waterrad 💧

Het derde rad: **wie haalt het water voor de afdeling?** Open `#/water` of kies 💧 Waterrad in de wissel bovenaan. Alles werkt zoals bij koffie (lokaal, live, Start met Slack via `#/water-slack`, plannen en kijklinks), met blauwe/aqua kleuren, een eigen icoon en eigen teksten ("Rondje gemeentepils van de zaak! Hydrateer ons trots."). `POST /api/sessions` accepteert ook `variant: "water"`. Water gebruikt bewust **dezelfde Slack-app als koffie** (geen nieuwe app of secrets) en telt uitsluitend **💧 `:droplet:`**-reacties. Zie [Waterrad in Slack](docs/slack-setup.md#waterrad).

Een aan een kanaal gekoppeld Koffierad doet ook waterrondes: typ `/waterrad` (of `/waterrad 10`) in het kanaal of klik op **💧 Vraag een waterronde aan** op de vaste kanaalpagina. Het is dezelfde koppeling met dezelfde links; het vaste kanaalrad en de meekijklink kleuren automatisch mee met de ronde (blauw bij water, bruin bij koffie). Per kanaal loopt één ronde tegelijk, koffie of water, met samen maximaal 25 per 24 uur. Zie [waterrondes toevoegen](docs/slack-setup.md#waterrondes-toevoegen-waterrad).

## Sterren voor de haler

Bij een Slack-live-rad kun je **Geef de haler sterren** aanzetten voordat je draait. Bij het aanvragen van een kanaalronde kan dezelfde keuze worden gemaakt; de beheerpagina kan ook de standaard instellen voor toekomstige rondes, inclusief rondes via de bestaande slash commands. De optie staat aanvankelijk uit. Kies na hoeveel minuten ná de laatste onthulling de beoordeling opent: 1–30 minuten, standaard 3. De sessie moet dan nog geldig zijn.

Als beoordelingen aanstaan, staan gedeeltelijk ingekleurde sterren onder iedere Slack-deelnemersnaam op het rad en in de deelnemerslijst. Het gemiddelde en het aantal beoordelingen blijven server-side bewaard per Slack-gebruiker, workspace en radtype: bier, koffie en water tellen apart. Wie nog geen beoordelingen heeft, krijgt lege sterren. Handmatige namen hebben geen Slack-identiteit en geen sterren. Beoordelingen veranderen de winkans niet.

Na de wachttijd verschijnt een pop-up. Een speler bevestigt met Slack dat die aan deze trekking meedeed en geeft iedere Slack-winnaar 1–5 sterren in één formulier. Iedere deelnemende, volwaardige workspacegebruiker mag per trekking één formulier versturen, ook na verversen of opnieuw inloggen. Stemmen blijven mogelijk tot de sessie verloopt/wordt beëindigd. Een volgende trekking of reset verwijdert eerdere nog beschikbare beoordelingen niet; een sessie bewaart maximaal 100 beoordeelbare trekkingen. Oude rondes blijven bereikbaar via hun eigen sessielink als de kanaalpagina inmiddels een nieuwe ronde toont.

De server bewaart scoretotaal, aantal en gemiddelde in SQLite. Een unieke stemclaim en alle scoreverhogingen worden samen transactioneel verwerkt; gelijktijdige stemmen overschrijven elkaar niet. De tijdelijke stemcontrole wordt uiterlijk bij de vaste Slack-toegangsdeadline gewist (zodat sessieverlenging geen tweede stem mogelijk maakt); de persoonsgemiddelden blijven bestaan. Er is geen openbare lijst of profielpagina. Zie de expliciete privacyreview in [SECURITY.md](SECURITY.md#persistent-ratings--reviewed-exception-2026-10-05). Backenddeploy vereist de nieuwe `RATINGS` binding en migratie `v3`; bestaande Slack-configuratie en scopes volstaan. Lokale handmatige raden werken zelfstandig zoals voorheen.

## Linkvoorbeelden

De statische HTML bevat Open Graph- en Twitter Card-metadata met een vaste publieke afbeelding: `public/social-preview.png` (1730 × 909). Alle fragmentroutes, inclusief live- en koffielinks, gebruiken dezelfde Bierrad-preview. De afbeelding bevat geen deelnemers, uitslagen of toegangscodes en vereist geen backendverzoek. De bestaande privacy-meta en CSP blijven behouden.

Bij een verhuizing naar een ander domein of subpad moeten de absolute `og:url`, `og:image` en `twitter:image`-adressen in `index.html` worden aangepast. Controleer na publicatie dat de PNG publiek bereikbaar is en deel de link opnieuw in de gewenste chatapp. Chatapps bepalen zelf uitsnede en weergave en kunnen eerdere previews cachen; bestaande berichten verversen niet noodzakelijk direct. Gebruik bij externe previewvalidators uitsluitend de publieke basis-URL, nooit een live- of hostlink.
