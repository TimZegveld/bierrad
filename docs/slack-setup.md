# Slack instellen

Slack is optioneel. Standalone en publieke handmatige live-sessies blijven zonder Slack werken. De implementatie gebruikt drie expliciete Web API-methoden via een kleine getypeerde fetch-client, zonder SDK/dependency of automatische SDK-retries. Raderen blijven volledig onafhankelijk.

## Bierrad-app: `/bierrad` in een kanaal

Het Bierrad werkt net als het [kanaal-Koffierad](#koffierad-aan-een-kanaal-koppelen), maar met de eigen Bierrad-app en eigen secrets. **Start met Slack** (een vrijdagbericht koppelen) bestaat niet meer.

### Eenmalig in de Bierrad-app

1. Werk de app bij met het [manifest](slack-app-manifest.json) (App Manifest in de appinstellingen). Nieuw zijn de bot scopes `reactions:write` (de bot zet zelf de eerste 🍻 onder zijn oproep) en `commands`, plus het slashcommando `/bierrad` met als Request URL `https://bierrad-live.timzegveld.workers.dev/slack/bier-commands` en zonder escaping. De user scope blijft `openid` voor Sign in with Slack, met redirect-URL `https://bierrad-live.timzegveld.workers.dev/auth/slack/callback`. Herinstalleer de app als Slack daarom vraagt; werk zo nodig `SLACK_BOT_TOKEN` bij.
2. Bewaar de secrets uitsluitend als Worker-secrets, interactief vanuit je eigen terminal (Client ID, Client Secret en Signing Secret staan onder **Basic Information → App Credentials**, het bottoken onder **OAuth & Permissions**):

```sh
npx wrangler secret put SLACK_BOT_TOKEN --env=""
npx wrangler secret put SLACK_CLIENT_ID --env=""
npx wrangler secret put SLACK_CLIENT_SECRET --env=""
npx wrangler secret put SLACK_SIGNING_SECRET --env=""
```

3. Zorg dat de custom emoji `spin-the-wheel` en `spinner` in de workspace staan; anders toont Slack ze als `:naam:`. Voor de sterren zie [steremoji's](#steremojis-voor-beoordelingen).

### Een kanaal koppelen

1. Nodig de bot uit in het kanaal: `/invite @Bierrad`.
2. Open `#/bier-koppelen` (of **Koppel aan een Slack-kanaal** op het lokale Bierrad), plak de kanaallink en log in met Slack. Alleen volwaardige leden van de workspace mogen koppelen. De bot plaatst een bevestiging met de vaste kanaallink (`#/bier/…`); jij krijgt de beheerpagina (`#/bier-beheer/…`, alleen voor jezelf).
3. Op de beheerpagina kies je het standaard aantal bierhalers (standaard 2), reviews aan/uit en de stemtijd (standaard 30 minuten).

### Gebruik

- `/bierrad`: vandaag om 15:45, met het standaard aantal halers.
- `/bierrad 15.44`, `/bierrad morgen`, `/bierrad vrijdag 16.00 3`, `/bierrad 10-10 16.30`: dag (`vandaag`, `morgen`, `overmorgen`, een weekdag of `dd-mm[-jjjj]`), tijd (`H.MM` of `H:MM`) en aantal (1–10) staan vooraan, in willekeurige volgorde. Een weekdag is de eerstvolgende waarop die tijd nog komt. Een tijd die al geweest is (of binnen een minuut) of meer dan 30 dagen vooruit ligt, wordt geweigerd.
- Alles daarna is je eigen tekst boven de vaste oproep, tot 500 tekens en 8 regels. Emoji-codes worden emoji en `*vet*` wordt vet; mentions, `@channel`, links en andere opmaak blijven gewone tekst.

De bot plaatst de oproep ("Het bierronde radje", met "radje" als link naar de ronde) en zet er een 🍻 onder. Twee minuten voor de start komt in de thread een bericht met **Inloggen** (om te reviewen) of **alleen meekijken**. Op de starttijd draait het rad op de server, de winnaars komen in de thread en de oproep wordt bijgewerkt. Per kanaal loopt één bierronde tegelijk.

## Lokale ontwikkeling en acceptatie

Gebruik uitsluitend een testworkspace met synthetische deelnemers. `.dev.vars.development` is genegeerd en mag lokaal `SLACK_BOT_TOKEN`, `SLACK_CLIENT_ID` en `SLACK_CLIENT_SECRET` van een testapp bevatten; nooit committen of tonen. Slack stuurt na inloggen alleen terug naar een geregistreerde redirect-URL, dus lokaal echt inloggen vraagt een testapp met een HTTPS-tunnel naar `wrangler dev`. Zonder tunnel test `npm test` de volledige inlogflow met een nep-Slack.

Zonder Slack-account/token test `npm test` de echte Worker/SQLite/alarms met een fake Slack API, en `npm run demo` een kanaalronde met nep-Slack.

## API-bronnen

- [reactions.get](https://docs.slack.dev/reference/methods/reactions.get/): `full=true`; het aantal moet overeenkomen met de unieke ontvangen gebruikers, anders geen import.
- [users.info](https://docs.slack.dev/reference/methods/users.info/): beperkte naamselectie; geen email scope.
- [chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/): parent `thread_ts`, geen reply_broadcast, plain_text blocks en niet-geparste fallback.
- [chat.update](https://docs.slack.dev/reference/methods/chat.update/): alleen de eigen oproep van een kanaalronde, met dezelfde `chat:write`-scope.
- [Sign in with Slack](https://docs.slack.dev/authentication/sign-in-with-slack/): `openid.connect.token` en ID-tokenclaims; [auth.test](https://docs.slack.dev/reference/methods/auth.test/) voor de workspace van de bot; [auth.revoke](https://docs.slack.dev/reference/methods/auth.revoke/) voor het gebruikerstoken.


## Appicoon en @vermeldingen

Upload `public/slack-icon.png` (1024 × 1024) in de Slack-appinstellingen onder **Basic Information → Display Information → App icon** en sla op. De PNG is een export van `public/slack-icon.svg`, gebaseerd op het bestaande favicon. Dit wijzigt het app/bot-icoon; er is geen extra scope of afzender-override nodig.

Nieuwe trekkingen vermelden Slack-winnaars met het officiële [rich-text user-element](https://docs.slack.dev/reference/block-kit/block-elements/user-element/). Slack toont hun actuele weergavenaam. Alleen door de server uit de importmapping verkregen identiteiten worden vermeld; ingevoerde namen kunnen geen @here/@channel of andere mentions injecteren. Bestaande pending jobs zonder mentionmapping blijven als tekst werken. Bestaande Slack-berichten worden niet gewijzigd. De tekstfallback bevat dezelfde server-bevroren identiteiten als `<@U…>`, omdat Slack meldingen uit die tekst afleidt; zonder die mention krijgt een winnaar geen notificatie. Handmatige namen blijven daarin ge-escapete tekst.

PNG opnieuw exporteren zonder projectdependency: `npx --yes --registry=https://registry.npmjs.org @resvg/resvg-js-cli@2.6.2-beta.1 --no-system-font public/slack-icon.svg public/slack-icon.png`.

## Aparte Koffierad-app

Maak een **nieuwe** app From a manifest met [slack-coffee-app-manifest.json](slack-coffee-app-manifest.json), installeer haar in de gewenste workspace en nodig de Koffierad-bot uit in het koffiekanaal. De bestaande Bierrad-app blijft bestaan. Upload [coffee-icon.png](../public/coffee-icon.png) (1024 × 1024) bij Basic Information → Display Information → App icon. De vectorbron is [coffee-icon.svg](../public/coffee-icon.svg).

De scopes zijn dezelfde minimale scopes als bij bier: bot `reactions:read`, `users:read`, `chat:write` en user `openid`, plus `reactions:write` en `commands` voor het [kanaal-Koffierad](#koffierad-aan-een-kanaal-koppelen). Het slashcommando `/koffierad` is het enige inkomende Slack-verzoek en vereist het signing secret; er zijn geen events of webhooks. Rondes starten met `/koffierad` in een [gekoppeld kanaal](#koffierad-aan-een-kanaal-koppelen) en collega's reageren met **☕ `:coffee:`** op de oproep van de bot; **Start met Slack** bestaat alleen voor het Bierrad.

Bewaar het **nieuwe** bot-token interactief, uitsluitend in het volgende Worker-secret:

```sh
npx wrangler secret put COFFEE_SLACK_BOT_TOKEN --env=""
npx wrangler secret put COFFEE_SLACK_CLIENT_ID --env=""
npx wrangler secret put COFFEE_SLACK_CLIENT_SECRET --env=""
```

Voeg in de Koffierad-app dezelfde redirect-URL en user scope `openid` toe. Koffie-inloggen gebruikt uitsluitend de Koffierad-app en haar bot; Bierrad-inloggen uitsluitend de Bierrad-app. Intrekken werkt per app: verwijderen van `COFFEE_SLACK_CLIENT_SECRET` schakelt koppelen, kanaalrondes en posts uit, zonder bier te veranderen. Reeds geïmporteerde deelnemers volgen de bestaande sessie-TTL.

De server selecteert de bot en reactie uit de onveranderlijke sessievariant; er is geen fallback naar de bierbot als koffie niet is ingesteld. De variant ligt vast in de inlogcookie en kan tijdens de callback niet wisselen. Het hoofdbericht mag beide reacties bevatten; iedere variant leest uitsluitend zijn eigen reactie. Refresh en officiële @vermeldingen blijven gelijk werken.

Publicatievolgorde: eerst de compatibele Worker, vervolgens de frontend; configureer daarna de koffie-appsecrets. Zonder koffiecredentials blijven lokaal en handmatig live draaien beschikbaar. Test na installatie met synthetische deelnemers dat alleen ☕ meetelt, twee kijkers dezelfde koffie-uitslag zien en precies één threadreply van de **Koffierad-bot** verschijnt, ook als de host sluit. Het toevoegen van deze broncode installeert of activeert de Slack-app nog niet.

### Waterrad

Het Waterrad gebruikt **dezelfde Koffierad-app** en dezelfde `COFFEE_SLACK_*`-secrets; er is geen aparte app en er zijn geen extra scopes of secrets nodig. Het bestaat alleen als ronde van een gekoppeld kanaal via `/waterrad` (zie [waterrondes toevoegen](#waterrondes-toevoegen-waterrad)); er is geen **Start met Slack** voor water. Collega's reageren met **💧 `:droplet:`**; ☕ en 🍻 tellen daar nooit mee, en omgekeerd telt 💧 nooit mee voor koffie of bier. De uitslag komt van de Koffierad-bot, met watertekst. Verwijderen van de koffiesecrets schakelt dus ook water uit. Upload eventueel [water-icon.png](../public/water-icon.png) (1024 × 1024, vectorbron [water-icon.svg](../public/water-icon.svg)) als je de app een algemener icoon wilt geven; dat is niet nodig.

## Steremoji's voor beoordelingen

Reviews tonen vijf sterren, inclusief gedeeltelijke sterren op één decimaal. Upload vóór publicatie van de backend de tien transparante PNG's uit [slack-emoji](slack-emoji/README.md) met hun exacte bestandsnamen als emojinaam. De volle ster gebruikt de bestaande `:star:`. Dit geldt voor bier-, koffie- en waterreviews en de bijgewerkte kanaaloproep; er zijn geen extra apprechten nodig.

## Koffierad aan een kanaal koppelen

Hiermee krijgt iedere afdeling een vast Koffierad in een eigen kanaal, waar iedereen een koffieronde kan aanvragen. Dit gebruikt de bestaande Koffierad-app; Bierrad verandert niet.

### Eenmalig in de Koffierad-app

1. Werk de app bij met het nieuwe [manifest](slack-coffee-app-manifest.json) (App Manifest in de appinstellingen). Nieuw zijn de bot scopes `reactions:write` (de bot zet zelf de eerste ☕ onder zijn oproep) en `commands`, plus het slashcommando `/koffierad` met als Request URL `https://bierrad-live.timzegveld.workers.dev/slack/commands`. Herinstalleer de app als Slack daarom vraagt; het bottoken blijft meestal gelijk, anders werk je `COFFEE_SLACK_BOT_TOKEN` bij.
2. Kopieer onder **Basic Information → App Credentials** het **Signing Secret** en bewaar het uitsluitend als Worker-secret, interactief vanuit je eigen terminal:

```sh
npx wrangler secret put COFFEE_SLACK_SIGNING_SECRET --env=""
```

3. Publiceer eerst de Worker (die bevat de nieuwe Durable Object-migratie `v2` voor `ChannelWheel`) en daarna de frontend.

### Waterrondes toevoegen (`/waterrad`)

Waterrondes gebruiken dezelfde Koffierad-app, dezelfde koppeling en dezelfde links; er zijn geen nieuwe secrets, scopes of migraties nodig en bestaande koppelingen hoeven niet opnieuw.

1. Publiceer eerst de Worker en daarna de frontend.
2. Werk de app bij met het [manifest](slack-coffee-app-manifest.json): nieuw is alleen het tweede slashcommando `/waterrad`, met **dezelfde** Request URL `https://bierrad-live.timzegveld.workers.dev/slack/commands`. Herinstalleer de app als Slack daarom vraagt. Wil je dat de bot in Slack niet meer "Koffierad" heet, pas dan de weergavenaam en eventueel het icoon aan. Voor de gecombineerde bot is er een gemengd koffie-watericoon: [slack-coffee-water-icon.png](../public/slack-coffee-water-icon.png) (1024 × 1024, vectorbron [slack-coffee-water-icon.svg](../public/slack-coffee-water-icon.svg)), te uploaden bij Basic Information → Display Information → App icon. Dat is optioneel en verandert niets aan de werking.
3. Test in een gekoppeld kanaal met synthetische testaccounts: `/waterrad 1` plaatst een 💧-oproep, alleen 💧 telt mee, `/koffierad` tijdens die ronde meldt dat er al een waterronde loopt, en het vaste kanaalrad kleurt blauw en daarna bij een koffieronde weer bruin.

### Koekrondes toevoegen (`/koekrad`)

Ook koekrondes gebruiken dezelfde Koffierad-app, dezelfde koppeling en dezelfde links; er zijn geen nieuwe secrets, scopes of migraties nodig.

1. Publiceer eerst de Worker en daarna de frontend.
2. Werk de app bij met het [manifest](slack-coffee-app-manifest.json): nieuw is alleen het derde slashcommando `/koekrad` (usage hint `[titel] [minuten]`), met **dezelfde** Request URL `https://bierrad-live.timzegveld.workers.dev/slack/commands`. Herinstalleer de app als Slack daarom vraagt.
3. Test in een gekoppeld kanaal met synthetische testaccounts: `/koekrad taart 1` plaatst een 🍪-oproep "Taartronde om …", alleen 🍪 telt mee, `/koffierad` tijdens die ronde meldt dat er al een taartronde loopt, en het vaste kanaalrad toont het Taartrad in koekkleuren. `/koekrad <!here>` of `/koekrad twee woorden` geeft alleen de uitleg.

### Per kanaal

Koekemoji's zoals `:alice-koek:` moeten als custom emoji in de workspace bestaan. Iedere menselijke reactor geeft het vak van de 🍪-deelnemer met precies die naam één extra lot, dus een groter vak en meer kans; zonder eenduidige naamsovereenkomst telt de reactie niet. Voor volledige namen kun je underscores gebruiken (`:alice_bakker-koek:`). Wint dat vak met een lot van een koekemoji, dan vermeldt de server de plaatser met "Mede mogelijk gemaakt door..." in dezelfde thread. Extra emoji's geven geen reviewstem. De bestaande `reactions.get`/`users.info` en scopes volstaan; geen extra appconfiguratie, secret of migratie. De grens van 100 telt alle 🍪- en koekemojireacties samen. Als Slack een onvolledige reactorlijst geeft, vervalt de import/eindcontrole zoals bij gewone reacties. Controleer na backendpublicatie met synthetische accounts het groter en weer kleiner worden van het vak, een ontbrekende of dubbele naam en de threadcredit.

1. Nodig de bot uit in het kanaal: `/invite @Koffierad`.
2. Open `https://timzegveld.github.io/bierrad/#/koffie-koppelen` (ook bereikbaar via **Koppel aan een Slack-kanaal** op het Koffierad), plak de kanaallink en log in met Slack. Alleen volwaardige leden van de workspace kunnen koppelen.
3. De bot plaatst een bevestiging met de vaste kanaallink in het kanaal. Die pagina is het vaste Koffierad van het kanaal: ze toont steeds het live rad en de uitslag van de laatste ronde en, als er niets loopt, hoe je in Slack een nieuwe ronde start. Geschikt voor een kantoor-tv. Na de eerste `/koffierad` toont het rad ook de kanaalnaam ("☕ Koffierad van #kanaal"); die naam stuurt Slack mee met het commando, dus er zijn geen extra rechten nodig. Via **🖥 Op ander scherm tonen** kopieer je een meekijklink in vijf woorden, die je ook makkelijk op een ander scherm overtypt; die toont alleen het rad en kan geen rondes starten. Koppelingen van vóór deze meekijklink krijgen er een via **Nieuwe kanaallink** op de beheerpagina. Jij komt op de **beheerpagina**: bewaar die link zelf, want hij wordt nergens anders getoond. Opnieuw koppelen van hetzelfde kanaal maakt nieuwe links en laat de oude vervallen.

### Een ronde

- Aanvragen met `/koffierad` / `/koffierad 10`, `/waterrad` / `/waterrad 10` of `/koekrad` / `/koekrad taart 10` (1 tot 30 minuten, zonder getal de standaardwachttijd; de titel van een koekronde is optioneel en één woord) in het kanaal. De kanaalpagina heeft geen startknoppen. Bij succes antwoordt het slashcommando niet (de oproep is de bevestiging); foutmeldingen zie alleen jij.
- De bot plaatst een oproep in het kanaal met een "Kijk live mee"-link naar de meekijklink in woorden (bij oudere koppelingen het vaste kanaalrad) en zet er direct een ☕ (waterronde: 💧, koekronde: 🍪) onder. Collega's klikken die aan; een ronde telt uitsluitend haar eigen reactie. De botreactie telt nooit mee: de bot wordt op gebruikers-ID én als bot uitgefilterd.
- Elke minuut leest de server de reacties, zodat kijkers het rad zien vollopen. Vlak voor de start volgt de normale eindcontrole. Daarna draait het rad met precies één winnaar, die met @vermelding in de thread van de oproep wordt gemeld (niet ook in het kanaal). De bot werkt de oproep zelf bij met de winnaar en het aantal deelnemers, zodat het kanaal per ronde één bericht houdt. Zonder deelnemers, of als de reacties niet te lezen zijn, staat dat in de bijgewerkte oproep. Mislukt het bijwerken, dan probeert de server het hooguit drie keer; de threaduitslag blijft de officiële uitslag.
- Met reviews (standaard aan met 15 minuten stemtijd, ook voor bestaande koppelingen; op de beheerpagina uit te zetten of anders in te stellen) linkt de oproep naar het vaste kanaalrad met **Open de ronde**. Daar kies je **Inloggen met Slack** (persoonlijke link, 30 dagen) of **Alleen kijken**. Een minuut na de laatste onthulling stemmen de deelnemers (niet de haler) via hun persoonlijke link. Daarna plaatst de bot de anonieme reviews in de thread en werkt hij de oproep bij met de sterren. Er is geen nieuwe scope of secret nodig. Voor inloggen moet de frontend met `VITE_API_URL` zijn gebouwd, zodat de CSP formulieren naar de backend toestaat.
- Het vaste kanaalrad en de meekijklink nemen het thema van de ronde over: bruin bij koffie, blauw bij water, koekkleuren (met de titel van de ronde) bij koek. Zonder lopende ronde blijft het thema van de laatste ronde staan.
- Per kanaal loopt er hooguit één ronde tegelijk, koffie, water of koek, met samen maximaal 25 rondes per 24 uur. Zodra het rad is gestopt (of de ronde niet doorging), kan direct een nieuwe ronde worden aangevraagd. Er wordt niet vermeld wie de ronde aanvroeg.

### Beheer en intrekken

Op de beheerpagina kun je de standaardwachttijd kiezen, een nieuwe aanvraaglink maken (de oude, ook die in Slack, werkt dan niet meer) en ontkoppelen. Een koppeling verloopt vanzelf na 90 dagen zonder rondes. Intrekken voor alle kanalen: verwijder `COFFEE_SLACK_SIGNING_SECRET` (alleen de slashcommando's `/koffierad`, `/waterrad` en `/koekrad`) of `COFFEE_SLACK_CLIENT_SECRET`/`COFFEE_SLACK_BOT_TOKEN` (alles van het Koffierad, ook water en koek).

Beperkingen: de aanvraaglink is bearer-toegang. Wie hem heeft, kan meekijken en inloggen om te beoordelen, ook buiten het kanaal als hij wordt doorgestuurd. Rondes starten kan alleen met `/koffierad`, `/waterrad` of `/koekrad` in het kanaal, niet met een link. De bot heeft geen `channels:read`, dus de beheerpagina toont geen kanaalnaam. Een onzekere Slack-post bij het aanvragen wordt niet herhaald: controleer dan het kanaal. Test na installatie met synthetische testaccounts dat de botreactie niet meetelt, `/koffierad` in een niet-gekoppeld kanaal een uitleg geeft en precies één threaduitslag verschijnt.
