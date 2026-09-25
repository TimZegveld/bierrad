# 🍻 Bierrad 🎡

Wie haalt deze week het bier? Een zelfstandige, Nederlandstalige React-app voor de vrijdagmiddag. Voeg deelnemers toe en draai twee keer: twee verschillende collega's worden de bierhalers. Geen account, database, Slack of betaalde diensten nodig.

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

Vite gebruikt `base: './'`, zodat gebouwde bestanden ook onder `/bierrad/` werken. De meegeleverde GitHub Actions-workflow test, controleert TypeScript, bouwt en publiceert bij pushes naar `main`. Kies in **Settings → Pages → Build and deployment → Source** voor **GitHub Actions**. De site komt daarna op https://timzegveld.github.io/bierrad/ . Voor handmatige hosting kun je de inhoud van `dist` als statische website publiceren. Er zijn geen serverroutes nodig.

## Architectuur

- `components/`: SVG-rad, deelnemersbeheer, onthullingen en confetti.
- `hooks/useBeerWheel.ts`: React-koppeling met de expliciete toestanden setup, ready, spinning-first, first-winner, spinning-second en finished.
- `utils/draw.ts`: zuivere toestandsovergangen, originele deelnemerssnapshot en reset.
- `utils/random.ts`: cryptografische selectie en berekening van de eindrotatie.
- `hooks/useWheelAnimation.ts`: Web Animations API met versnelling, meerdere omwentelingen en vertraging. Annuleert bij unmount en ondersteunt reduced motion.
- `services/ManualParticipantSource.ts`: validatie en lokale opslag achter de asynchrone `ParticipantSource`-interface.
- `tests/`: belangrijke gedragsregels, opslagvalidatie en geometrische uitlijning, los van animaties getest met de Node-testrunner.

De winnaar wordt **vóór** de animatie bepaald met `crypto.getRandomValues()`. Rejection sampling voorkomt modulo-bias. Daarna wordt de rotatie berekend zodat het midden van het gekozen segment exact onder de vaste aanwijzer stopt. Animatietiming heeft geen invloed op de uitslag. De tweede trekking sluit het ID van de eerste winnaar uit. Alle deelnemers hebben per trekking gelijke kansen. Een lokaal beheerder kan deze clientapp aanpassen; hij is bedoeld voor informele kantoorlotingen.

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
