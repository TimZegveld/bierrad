# 🍻 Bierrad 🎡

Wie haalt deze week het bier? Een zelfstandige, Nederlandstalige React-app voor de vrijdagmiddag. Voeg deelnemers toe, kies het aantal bierhalers en laat alle raderen tegelijk draaien. Iedere bierhaler krijgt een eigen rad en iedere trekking levert unieke winnaars op. Geen account, database, Slack of betaalde diensten nodig.

## Productvisie

Lees [de productvisie](vision.md) voor de kernervaring, productprincipes en richting van Bierrad. Gebruik dit document als referentie bij ontwerpkeuzes en nieuwe features; toekomstige ideeën zijn geen MVP-requirements.

## Security- en privacykaders

De [security-, privacy- en agentguardrails](docs/security-guardrails.md) zijn vastgelegd als projectcontext voor toekomstige wijzigingen. Behandel frontend en browser als publiek en onbetrouwbaar; credentials en geprivilegieerde handelingen horen server-side. Toekomstige livegegevens vereisen tijdelijke sessies met afzonderlijke host- en spectatorrechten. De beschreven documentatie- en auditopdracht is nog niet uitgevoerd; dit document is geen afgeronde security-audit.

## Lokaal starten

Gebruik Node.js 22.12+ (of 20.19+).

```sh
npm install
npm run dev
```

```sh
npm test
npm run typecheck
npm run build
npm run preview
```

## Gebruik

Voeg minstens één deelnemer toe en kies **Aantal bierhalers** met de min- en plusknop. De standaardvoorkeur is 2; het effectieve aantal ligt tussen 1 en het aantal deelnemers. Als de lijst kleiner wordt, daalt het aantal automatisch mee. Bij een lege lijst blijft de trekking uitgeschakeld.

Je expliciete aantalkeuze wordt in localStorage onthouden. De voorkeur blijft bewaard als een kleinere lijst tijdelijk minder winnaars toestaat; bij uitbreiding kan de gekozen voorkeur weer gebruikt worden. Zo levert het één voor één toevoegen van deelnemers standaard twee raderen op zodra er twee mensen meedoen. Namen mogen maximaal 32 tekens bevatten; dubbele namen worden zonder onderscheid tussen hoofdletters geweigerd.

Druk op **DRAAI HET BIERRAD!** om alle raderen tegelijk te starten. Ieder rad bevat dezelfde volledige deelnemerslijst. Alle unieke winnaars worden vooraf gekozen; de animaties tonen vervolgens die uitslag. Tijdens de trekking staan deelnemers- en aantalbediening uit. De raderen stoppen kort na elkaar en onthullen elk hun eigen winnaar. Zodra alle raderen klaar zijn, verschijnt de gezamenlijke finale met confetti.

**Opnieuw draaien** start direct een geheel nieuwe trekking met hetzelfde aantal en dezelfde deelnemers. Eerdere winnaars kunnen opnieuw winnen; iedere trekking is onafhankelijk. **Deelnemers aanpassen** wist de huidige uitslag en brengt je terug naar de instellingen met de deelnemers intact. Daar kun je ook de lijst wissen.

De laatste niet-lege deelnemerslijst blijft beschikbaar via **Vorige lijst**, ook na **Alles wissen**. Een nieuwe niet-lege lijst vervangt deze opgeslagen lijst. De lijst wordt bij openen automatisch geladen. Bij geblokkeerde browseropslag blijft de app in het huidige venster werken. Er wordt geen trekkinggeschiedenis opgeslagen.

Eén rad is groot en centraal; meerdere raderen krijgen een responsive grid van maximaal drie kolommen. Vier raderen vormen bij voldoende ruimte een 2×2-opstelling. Op een telefoon stapelen ze onder elkaar. De knop rechtsboven activeert volledig scherm waar de browser dit ondersteunt. Reduced motion wordt gerespecteerd. Google Fonts is optionele aankleding; systeemlettertypen blijven beschikbaar zonder externe verbinding.

## GitHub Pages

Repository: https://github.com/TimZegveld/bierrad

Vite gebruikt `base: './'`, zodat gebouwde bestanden ook onder `/bierrad/` werken. De meegeleverde GitHub Actions-workflow test, controleert TypeScript, bouwt bij pushes naar `main`; publiceren gebeurt alleen als hosting is ingeschakeld (zie hieronder). Kies in **Settings → Pages → Build and deployment → Source** voor **GitHub Actions**. De site komt daarna op https://timzegveld.github.io/bierrad/ . Voor handmatige hosting kun je de inhoud van `dist` als statische website publiceren. Er zijn geen serverroutes nodig.

## Architectuur

```text
ParticipantSource
       ↓
SessionController
       ↓
Draw Engine
       ↓
DrawInstruction
       ↓
SpinInstruction[]
       ↓
Wheel Renderers
```

- **ParticipantSource** levert alleen deelnemers. De bron weet niets over aantal winnaars, raderen of animaties. `ManualParticipantSource` leest lokaal opgeslagen namen en stabiele IDs; Slack blijft een toekomstige bron.
- **SessionController** biedt stabiele snapshots, subscriptions en asynchrone commando's: `setParticipants`, `setWinnerCount`, `restoreParticipants`, `startDraw` en `reset`. `LocalSessionController` is nu de autoriteit; React is onafhankelijk van de implementatie. Opslag en aantalvoorkeur worden in `main.tsx` aangesloten.
- **Draw Engine** kiest alle N winnaars als één operatie en bouwt de volledige instructie vóórdat een nieuwe snapshot gepubliceerd wordt. `selectUniqueWinners` gebruikt een gedeeltelijke Fisher–Yates-shuffle met `crypto.getRandomValues()` en rejection sampling, dus zonder modulo-bias. Iedere deelnemer heeft dezelfde inclusiekans en verschijnt maximaal eenmaal. De volledige deelnemerslijst blijft intact.
- **DrawInstruction** heeft één ID, één UTC-starttijd, de volledige geordende deelnemerspool en N `SpinInstruction`s. Alle spins delen dezelfde starttijd. Elke spin bevat zijn radindex, winnaar, duur, aantal omwentelingen, beginrotatie, eindrotatie en easing. Variatie ligt vooraf vast: zes of zeven omwentelingen en 4,8 tot 5,25 seconden. De lokale trekking krijgt een gezamenlijke aanlooptijd van 100 ms.
- **Wheel Renderers** spelen uitsluitend de ontvangen instructies af. `WheelGrid` toont één `BeerWheel` per spin en overal dezelfde volledige deelnemerspool. Geen component kiest winnaars of wijzigt animatie-eigenschappen willekeurig. `useBeerWheel` gebruikt `useSyncExternalStore` om React op sessiewijzigingen aan te sluiten.

De deelbare modellen staan in `src/domain/models.ts`. Een `BeerWheelSession` bevat deelnemers, het effectieve `winnerCount`, de onthulde winnaar-IDs en `activeDraw`. Die instructie blijft na afloop beschikbaar, zodat opnieuw gemounte raderen dezelfde eindposities tonen. De toestanden zijn `setup`, `ready`, `countdown`, `spinning` en `finished`. `countdown`, `scheduled` en `scheduledAt` zijn gereserveerd voor de toekomst; er is geen scheduler.

### Timing, herhalen en rollen

De controller onthult resultaten op hun vastgelegde deadlines en zet de sessie pas op `finished` als alle raderen voltooid zijn. Animatiecallbacks bepalen geen uitslag of sessieovergang. De renderer wacht op toekomstige starttijden, hervat een lopende animatie op de verstreken tijd binnen de oorspronkelijke easingcurve, en toont direct de eindpositie als die tijd voorbij is. Reduced motion slaat de beweging over, maar behoudt de autoritatieve eindtijd.

`startDraw()` werkt vanuit een klaarstaande of voltooide sessie en selecteert altijd opnieuw uit de volledige pool. Voor herhalen sluiten de beginrotaties aan op de vorige eindposities. `reset()` wist instructie en uitslag, behoudt deelnemers en aantal en opent de instellingen weer.

Host- en toeschouwersrechten komen uit één capabilitymodel. De UI verbergt muterende bediening voor spectators; de controller controleert ook zelf ieder commando. Dit is **geen authenticatie**: een toekomstige backend moet rechten zelf afdwingen. De huidige standalone app start als lokale host.

### Live Bierrad voorbereiden

Een toekomstige server kan één `DrawInstruction` met bijvoorbeeld vijf spins publiceren. Alle clients krijgen dezelfde pool, resultaten, starttijd en animatieparameters. Spectators hoeven geen winnaarselectie uit te voeren. De bestaande radcomponenten kunnen dit al weergeven; alleen de remote adapter en opstartbedrading zijn nieuw werk.

Dit is **geen volledige live-synchronisatie**. Protocolvalidatie, serverklokcorrectie, reconnects, late-join-snapshots, WebSockets en Cloudflare Durable Objects moeten later worden gebouwd. Ook scheduling, authenticatie en Slack-communicatie zijn niet geïmplementeerd. De lokale app vereist geen backend of configuratie.

Tests controleren sampling voor 1 t/m alle deelnemers, ongeldige aantallen, gelijke samplingpaden, gedeelde starttijden, segmentuitlijning, deterministische instructies, staggered onthullingen, capabilities, reset, voorkeuren en onafhankelijke herhalingen. Een spectator-renderingtest speelt een instructie met vijf spins af met random APIs uitgeschakeld. Animaties worden niet frame voor frame getest.

## Geplande Slack-integratie

Slack is zichtbaar als uitgeschakelde toekomstige optie. Er is nog geen Slack-backend of API-communicatie. `SlackParticipantSource`, `SlackThread` en `WinnerPublisher` definiëren de uitbreidingspunten; een toekomstige HTTP-adapter kan dezelfde deelnemersflow voeden.

De backend ontvangt later een Slack-bericht-URL, valideert deze, extraheert kanaal en timestamp, haalt gebruikers met de `:beers:`-reactie op en retourneert hun weergavenamen met stabiele IDs. Na de trekking kan de publisher een antwoord in de originele thread plaatsen:

```text
🍻🎡 Het Bierrad heeft gesproken!

De gelukkige winnaars van deze week zijn:

🍺 [Naam van iedere geselecteerde bierhaler, één per regel]

Succes heren/dames. Het volk heeft dorst.
```

**Slack-tokens, secrets en credentials mogen nooit in frontendcode of `VITE_*`-variabelen staan.** Deze zijn publiek leesbaar in de browserbundel. Gebruik later een kleine beveiligde backend, bijvoorbeeld een Cloudflare Worker, met server-side secrets, authenticatie, minimale Slack-scopes en gevalideerde verzoeken. GitHub Pages blijft uitsluitend de frontend hosten.

### Hosting inschakelen

Deployment staat standaard uit. Voeg na het instellen van GitHub Pages de repositoryvariabele ENABLE_PAGES met waarde true toe onder Settings → Secrets and variables → Actions → Variables. Start daarna de workflow opnieuw. Controleer voor deze privérepository of Pages beschikbaar is binnen je GitHub-abonnement. Tests en builds werken ook zonder hosting.
