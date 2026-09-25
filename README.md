# 🍻 Bierrad 🎡

Wie haalt deze week het bier? Een zelfstandige, Nederlandstalige React-app voor de vrijdagmiddag. Voeg deelnemers toe en draai twee keer: twee verschillende collega's worden de bierhalers. Geen account, database, Slack of betaalde diensten nodig.

## Productvisie

Lees [de productvisie](vision.md) voor de kernervaring, productprincipes en richting van Bierrad. Gebruik dit document als referentie bij ontwerpkeuzes en nieuwe features; toekomstige ideeën zijn geen MVP-requirements.

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

Voeg minimaal twee namen toe. Namen mogen maximaal 32 tekens bevatten; dubbele namen worden zonder onderscheid tussen hoofdletters geweigerd. Start de eerste trekking en klik na de onthulling op **Draai voor nummer 2**. De eerste winnaar wordt uit het rad verwijderd. Tijdens een ronde is de deelnemerslijst vergrendeld.

**Opnieuw met dezelfde deelnemers** herstelt de volledige oorspronkelijke lijst. **Nieuw bierrad** maakt het huidige rad leeg. De laatste niet-lege lijst blijft in localStorage beschikbaar via **Vorige lijst**, ook na **Alles wissen**. Een nieuwe niet-lege lijst vervangt deze opgeslagen lijst. De lijst wordt bij het openen automatisch geladen. Als browseropslag is geblokkeerd, blijft de app in het huidige venster werken en verschijnt een melding. Er wordt geen trekkinggeschiedenis opgeslagen.

Het rad werkt ook met precies twee deelnemers; de tweede draai heeft dan één segment. Bewegingsvoorkeuren van de browser worden gerespecteerd. De knop rechtsboven activeert volledig scherm waar de browser dit ondersteunt. Google Fonts is optionele visuele aankleding; systeemlettertypen blijven beschikbaar zonder externe verbinding.

## GitHub Pages

Repository: https://github.com/TimZegveld/bierrad

Vite gebruikt `base: './'`, zodat gebouwde bestanden ook onder `/bierrad/` werken. De meegeleverde GitHub Actions-workflow test, controleert TypeScript, bouwt bij pushes naar `main`; publiceren gebeurt alleen als hosting is ingeschakeld (zie hieronder). Kies in **Settings → Pages → Build and deployment → Source** voor **GitHub Actions**. De site komt daarna op https://timzegveld.github.io/bierrad/ . Voor handmatige hosting kun je de inhoud van `dist` als statische website publiceren. Er zijn geen serverroutes nodig.

## Architectuur

```text
ParticipantSource → SessionController → Draw Engine → SpinInstruction → Wheel Renderer
```

- **ParticipantSource** levert deelnemers. `ManualParticipantSource` leest localStorage en bewaart bestaande IDs. Een toekomstige Slack-bron kan dezelfde interface gebruiken.
- **SessionController** is de grens voor React: een stabiele snapshot, een abonnement op updates en asynchrone commando's voor deelnemers, draaien en resetten. `LocalSessionController` is nu de autoriteit. Hij laadt de bron, kiest winnaars, maakt instructies en voltooit de trekking op zijn eigen klok. Ook zonder gemount rad gaat de sessie door. Opslag wordt via een callback aangesloten; de controller kent geen localStorage.
- **Draw Engine** (`src/domain/drawEngine.ts`) bevat zuivere toestandsovergangen en controles. De oorspronkelijke deelnemerslijst blijft behouden; getrokken IDs en de segmentvolgorde van de laatste draai bepalen de getoonde lijst. Reset herstelt iedereen.
- **SpinInstruction** bevat een unieke ID, ronde, geordende deelnemers-IDs, winnaar-ID, UTC-starttijd, duur, beginrotatie, eindrotatie en easing. Vanaf dat moment liggen de animatie en de uitslag vast.
- **Wheel Renderer** (`BeerWheel` en `useWheelAnimation`) speelt uitsluitend die instructie af. Hij trekt geen winnaar, berekent geen willekeurige rotatie en kan geen sessieovergang uitvoeren. `useBeerWheel` koppelt React via `useSyncExternalStore` aan iedere implementatie van de controller-interface.

De deelbare modellen staan in `src/domain/models.ts`, zonder React- of backenddependencies. Een `BeerWheelSession` bevat één oorspronkelijke deelnemerslijst, winnaar-IDs en de laatste instructie. Die instructie blijft na afloop beschikbaar zodat een opnieuw gemount rad dezelfde positie toont. `countdown`, `scheduled` en `scheduledAt` zijn uitsluitend gereserveerde domeinbegrippen; er is geen scheduler.

De winnaar wordt **vóór** de animatie bepaald met `crypto.getRandomValues()`. Rejection sampling voorkomt modulo-bias. De engine berekent daarna een rotatie met zes volledige omwentelingen plus uitlijning van het geselecteerde segment onder de pointer. De tweede trekking sluit de eerste winnaar uit. De lokale controller bepaalt de onthulling op `startAt + durationMs`; animatietiming heeft geen invloed op de uitslag.

### Tijd en rollen

De renderer wacht op een toekomstige `startAt`. Bij een al lopende instructie zet hij de Web Animation op de verstreken tijd binnen de oorspronkelijke easingcurve. Na de eindtijd toont hij direct de eindpositie. Dit is lokale afspeelondersteuning, **geen volledige late-join-synchronisatie**: netwerkherverbindingen, klokverschillen, verouderde events en sessieherstel moeten later door een remote adapter worden afgehandeld. Bij reduced motion blijft het rad stil en springt het op de gedeelde eindtijd naar de winnaar; de autoritatieve timing verandert niet.

Host- en toeschouwersrechten komen uit één capabilitymodel (`src/domain/capabilities.ts`). De UI verbergt muterende bediening voor toeschouwers. De lokale controller controleert de rechten bovendien bij ieder commando. Dit is een programmeergrens, **geen authenticatie of beveiliging tegen een aangepaste client**; een toekomstige server moet rechten zelf afdwingen. De huidige app start altijd als lokale host en heeft geen `/host`- of `/live`-routes.

### Later een RemoteSessionController toevoegen

De compositie staat in `src/main.tsx`. Daar kan later een remote controller worden aangesloten in plaats van de lokale controller en opslagbron. De remote implementatie verstuurt hostcommando's, ontvangt server-snapshots en publiceert deze via dezelfde interface. Spectators hebben daarbij geen lokale winnaarselectie nodig. De server wordt dan verantwoordelijk voor toeval, timing, toestanden en permissies; clients mogen geen trekking voltooien.

**Architectuurreview:** bestaande bestanden met grote wijzigingen bij toekomstige WebSockets: geen van de rad- of kern-Reactcomponenten. Alleen de opstartbedrading in `main.tsx` verandert; de remote adapter, protocolvalidatie, klokcorrectie en backend zijn nieuw werk. De gedeelde modellen kunnen later naar een gedeeld pakket verhuizen. `App`, `useBeerWheel`, `BeerWheel` en de lokale controller kunnen hun huidige verantwoordelijkheid behouden.

Dit bereidt Slack-deelnemers, WebSockets, Cloudflare Durable Objects, spectators en geplande trekkingen voor. **Geen van die integraties is nu geïmplementeerd.** Er zijn geen extra dependencies, servercode, authenticatie, cronjobs of database toegevoegd. De volledige lokale flow werkt zonder Cloudflare of Slack.

Tests controleren deelnemersbeheer, willekeurige selectie, controllercommando's, klokgestuurde afronding, uitsluiting van eerdere winnaars, deterministische instructies, rollen, subscriptions, opslagfouten en reset. Een React-renderingtest gebruikt bovendien een andere controllerimplementatie met vaste snapshots. Animaties worden niet frame voor frame getest.

## Geplande Slack-integratie

Slack is zichtbaar als uitgeschakelde toekomstige optie. Er is nog geen Slack-backend of API-communicatie. `SlackParticipantSource`, `SlackThread` en `WinnerPublisher` definiëren de uitbreidingspunten; een toekomstige HTTP-adapter kan dezelfde deelnemersflow voeden.

De backend ontvangt later een Slack-bericht-URL, valideert deze, extraheert kanaal en timestamp, haalt gebruikers met de `:beers:`-reactie op en retourneert hun weergavenamen met stabiele IDs. Na de trekking kan de publisher een antwoord in de originele thread plaatsen:

```text
🍻🎡 Het Bierrad heeft gesproken!

De gelukkige winnaars van deze week zijn:

🍺 [Winner 1]
🍺 [Winner 2]

Succes heren/dames. Het volk heeft dorst.
```

**Slack-tokens, secrets en credentials mogen nooit in frontendcode of `VITE_*`-variabelen staan.** Deze zijn publiek leesbaar in de browserbundel. Gebruik later een kleine beveiligde backend, bijvoorbeeld een Cloudflare Worker, met server-side secrets, authenticatie, minimale Slack-scopes en gevalideerde verzoeken. GitHub Pages blijft uitsluitend de frontend hosten.

### Hosting inschakelen

Deployment staat standaard uit. Voeg na het instellen van GitHub Pages de repositoryvariabele ENABLE_PAGES met waarde true toe onder Settings → Secrets and variables → Actions → Variables. Start daarna de workflow opnieuw. Controleer voor deze privérepository of Pages beschikbaar is binnen je GitHub-abonnement. Tests en builds werken ook zonder hosting.
