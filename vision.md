# 🍻🎡 Bierrad — Product Vision

## Waarom bestaat Bierrad?

Elke vrijdag is er maar één vraag die er echt toe doet:

**Wie haalt het bier?**

Bierrad maakt van die simpele vraag een klein wekelijks evenement.

In plaats van namen uit een lijst te trekken, maken we er bewust een moment van. Collega's melden zich aan, ieder te vergeven plekje krijgt een eigen rad en iedereen kijkt mee. Een instelbaar aantal ongelukkige — of gelukkige — collega's wordt door het lot aangewezen.

Bierrad moet vooral **leuk** zijn.

Het is geen enterprise-tool.  
Het is geen HR-systeem.  
Het is geen generieke random-name-picker.

Het is:

> **Het officiële, totaal onnodig spectaculaire systeem om te bepalen wie vrijdag het bier haalt.**

---

# Kernervaring

De ideale vrijdagmiddag ziet er zo uit:

1. In Slack verschijnt het wekelijkse bericht over de bierronde (toekomstige integratie).
2. Collega's melden zich aan met `:beers:`; handmatig invoeren blijft altijd mogelijk.
3. Iemand opent Bierrad op een groot scherm en laadt de deelnemers.
4. De host kiest het aantal bierhalers, standaard twee en maximaal het aantal deelnemers.
5. Iedere bierhaler krijgt een eigen rad. Elk rad toont dezelfde volledige deelnemerslijst.
6. Iedereen kan controleren of hij/zij erop staat.
7. Eén druk op de grote knop start de volledige trekking.
8. Het systeem kiest alle unieke winnaars voordat een animatie begint.
9. Alle raderen starten gelijktijdig. De spanning loopt op.
10. Ze vertragen elk iets anders en stoppen kort na elkaar bij hun vooraf gekozen winnaar.
11. Ieder rad onthult zijn bierhaler; zodra alle raderen klaar zijn volgt één feestelijke finale.
12. De uitslag kan later in dezelfde Slack-thread worden geplaatst.

Het hele proces moet binnen ongeveer een minuut kunnen plaatsvinden.

Maar die minuut mag wel voelen alsof de WK-finale wordt beslist.

---

# Productprincipes

## 1. Fun boven efficiëntie

Technisch gezien kunnen we alle willekeurige winnaars in minder dan een milliseconde selecteren.

Dat is niet het doel.

Het draaien van het rad **is onderdeel van het product**.

Animatie, spanning, humor en presentatie zijn belangrijker dan maximale efficiëntie.

---

## 2. Het lot bepaalt

De selectie moet daadwerkelijk willekeurig zijn.

Alle unieke winnaars worden als één trekking vóór de animaties bepaald met cryptografisch betrouwbare randomness: lokaal in de browser, in Live Mode uitsluitend op de server. Bijvoorbeeld:

```typescript
crypto.getRandomValues()
```

De raderen visualiseren vervolgens die gezamenlijke uitslag.

De animatie zelf mag nooit bepalen wie wint.

Daardoor kunnen we garanderen dat:

- iedereen dezelfde kans heeft;
- de animatie de uitslag niet beïnvloedt;
- dezelfde persoon binnen één trekking niet meermaals wordt gekozen. Iedere nieuwe trekking is onafhankelijk: eerdere winnaars mogen opnieuw winnen.

---

## 3. Iedereen moet het begrijpen

Bierrad wordt niet alleen door developers gebruikt.

Iemand moet zonder uitleg kunnen zien:

- wie meedoet;
- hoeveel mensen meedoen;
- wat hij moet aanklikken;
- wie gewonnen heeft;
- wat de volgende stap is.

Als een feature uitleg nodig heeft om de wekelijkse bierronde te starten, is de UX waarschijnlijk te ingewikkeld.

---

## 4. Eén groot moment

Het rad is de ster van de applicatie.

Niet de instellingen.

Niet Slack.

Niet een deelnemerslijst.

Niet statistieken.

Wanneer Bierrad op een groot scherm staat, moet het rad onmiddellijk de aandacht trekken.

De primaire actie moet onmogelijk te missen zijn:

**🍻 DRAAI HET BIERRAD!**

---

# Visuele identiteit

Bierrad moet voelen als:

**vrijdagmiddag + kroeg + spelshow + kantoorhumor**

Niet als:

- SaaS-dashboard;
- adminportal;
- corporate intranet;
- casino-app;
- kinderapp.

De interface mag speels zijn, maar moet er verzorgd en modern uitzien.

## Visuele elementen

Denk aan:

- groot kleurrijk rad;
- bierglazen;
- subtiele bierbubbels;
- confetti;
- feestelijke winnaar-presentatie;
- grote typografie;
- duidelijke namen;
- bewegende aanwijzer;
- lichte glow/highlight-effecten;
- subtiele diepte en schaduwen.

Animaties mogen overdreven zijn wanneer ze bijdragen aan de spanning.

---

# Het rad

Het rad moet visueel overtuigend zijn.

Iedere deelnemer krijgt:

- één segment;
- dezelfde winkeldimensie/kans;
- duidelijk leesbare naam.

Bij veel deelnemers moet het rad zichzelf aanpassen zodat namen zo lang mogelijk leesbaar blijven.

Het rad heeft een duidelijke vaste pointer.

Tijdens het draaien:

- start het krachtig;
- draait het meerdere volledige rondes;
- vertraagt het geleidelijk;
- beweegt de pointer mee alsof deze langs segmenten tikt;
- stopt het exact op de vooraf gekozen winnaar.

De laatste seconden van de animatie zijn belangrijk.

Het moet voelen alsof het rad nét langs andere kandidaten kruipt voordat het stopt.

---

# Een instelbare bierbrigade

**Een trekking selecteert een instelbaar aantal unieke bierhalers.**

De standaardvoorkeur is twee; één bierhaler of een grotere groep is net zo natuurlijk. Het aantal mag nooit groter zijn dan de deelnemerslijst. Als de lijst kleiner wordt, past het effectieve aantal zich aan. De expliciete voorkeur wordt lokaal onthouden.

Iedere winnaar krijgt een eigen rad. Alle raderen tonen de volledige deelnemerspool en starten op hetzelfde moment. Namen worden niet uit andere raderen verwijderd: centrale selectie zonder teruglegging garandeert verschillende winnaars.

Subtiele verschillen in duur en omwentelingen maken het spannend. Deze verschillen staan vooraf vast in de gezamenlijke trekking; de weergave voegt geen toeval toe. Onder elk gestopt rad verschijnt de bijbehorende winnaar.

Eén rad is groot en centraal, twee en drie staan naast elkaar als daar genoeg ruimte voor is. Vier vormen bij voorkeur een gebalanceerd 2×2-raster. Meer raderen krijgen een responsive grid. Op mobiel stapelen ze onder elkaar: leesbare namen gaan boven zoveel mogelijk raderen op één rij.

Tijdens het draaien zijn deelnemers en aantal vergrendeld. Na de finale start **Opnieuw draaien** direct een nieuwe trekking uit dezelfde volledige pool. **Deelnemers aanpassen** brengt je terug naar de instellingen.

---

# Finale

De finale moet groter aanvoelen dan de individuele onthullingen.

Bijvoorbeeld:

> # 🍻 HET RAD HEEFT GESPROKEN! 🍻
>
> ## TIM · JAN · ROBIN
>
> **Jullie mogen bier halen!**

Pas als alle raderen klaar zijn: confetti en een duidelijke feestelijke animatie. Alle winnaars krijgen een plek; bij één winnaar staat er “Jij mag bier halen!”.

De exacte teksten mogen in de toekomst variëren.

Humor is welkom.

---

# Handmatige modus

Slack mag nooit noodzakelijk zijn om Bierrad te gebruiken.

Er moet altijd een eenvoudige handmatige modus bestaan.

Daarin kunnen gebruikers:

- namen toevoegen;
- namen verwijderen;
- deelnemers wissen;
- eerdere deelnemers herstellen;
- het aantal bierhalers kiezen;
- alle raderen tegelijk starten.

De lijst wordt lokaal onthouden.

Hierdoor blijft Bierrad bruikbaar wanneer:

- Slack niet beschikbaar is;
- permissions veranderen;
- de Slack-integratie stuk is;
- we spontaan een rad willen gebruiken.

---

# Slack-visie

Slack is uiteindelijk de primaire bron voor deelnemers.

De wekelijkse Slack-post bevat een oproep voor de bierronde.

Collega's melden zich aan door met:

`:beers:`

te reageren.

Bierrad leest vervolgens alleen de gebruikers die met deze specifieke emoji hebben gereageerd.

Conceptueel:

```text
Slack message
      ↓
:beers: reactions
      ↓
Slack user IDs
      ↓
Display names
      ↓
Participants
      ↓
Bierrad
```

Slack moet voelen als een **ingang naar Bierrad**, niet als het product zelf.

---

# Slack-resultaat

Na de trekking moet de uitslag terug naar de oorspronkelijke thread kunnen.

Bijvoorbeeld:

> 🍻🎡 Het Bierrad heeft gesproken!
>
> De gelukkige winnaars van deze week zijn:
>
> 🍺 Tim  
> 🍺 Jan\
> 🍺 Robin
>
> Succes heren/dames. Het volk heeft dorst.

Het bericht bevat alle geselecteerde bierhalers, ongeacht het aantal. De toon mag speels zijn en kan later eventueel variëren.

---

# Security

Slack tokens en andere secrets mogen **nooit** onderdeel zijn van de frontend.

De browser praat met onze eigen kleine backend.

```text
Browser
   ↓
Bierrad API
   ↓
Slack API
```

De Slack credentials bestaan alleen aan de serverzijde.

Bierrad verzamelt en bewaart zo min mogelijk gegevens.

Er is geen database nodig zolang daar geen duidelijke productreden voor bestaat.

---

# Architectuurprincipe

De frontend mag niet afhankelijk zijn van Slack.

De bron van deelnemers is abstraheerbaar.

Bijvoorbeeld:

```typescript
interface ParticipantSource {
    getParticipants(): Promise<Participant[]>;
}
```

Mogelijke implementaties:

```text
ParticipantSource

├── ManualParticipantSource
└── SlackParticipantSource
```

De deelnemersbron weet niets van winnaar- of radaantallen. De sessiecontroller laat de engine één `DrawInstruction` maken met de volledige geordende deelnemerspool en N `SpinInstruction`s. De renderers krijgen de deelnemers en hun instructie en doen uitsluitend de weergave. Geen rad kiest zelfstandig een winnaar.

```text
ParticipantSource → SessionController → Draw Engine
                                           ↓
                                    DrawInstruction
                                           ↓
                                  SpinInstruction[]
                                           ↓
                                    Wheel Renderers
```

---

# Wat Bierrad NIET moet worden

We moeten oppassen voor feature creep.

Bierrad hoeft geen:

- account-systeem;
- uitgebreid adminpanel;
- employee directory;
- Slack-managementtool;
- analyticsplatform;
- planningstool;
- complexe database;
- generic wheel-builder;

te worden.

Een nieuwe feature moet bijdragen aan minimaal één van deze doelen:

**makkelijker deelnemen**

**makkelijker draaien**

**meer spanning**

**meer lol**

Anders hoort de feature waarschijnlijk niet in Bierrad.

---

# Mogelijke toekomstige ideeën

Deze zijn expliciet **geen requirements voor de MVP**.

Ze mogen alleen worden toegevoegd wanneer de kernervaring goed werkt.

### 🎵 Geluid

Een subtiel tikgeluid wanneer de pointer langs segmenten beweegt.

Bij de winnaar eventueel een korte feestelijke sound.

Geluid moet uitgeschakeld kunnen worden.

### 🖥️ Fullscreen mode

Een presentatiemodus waarbij vrijwel alleen het rad zichtbaar is.

Ideaal voor een groot scherm op kantoor.

### 🍺 Verschillende winnaarsteksten

Bijvoorbeeld willekeurig:

> Gefeliciteerd. Je carrière heeft een nieuw dieptepunt bereikt.

> Het rad heeft gesproken. Tegen het rad valt niet te discussiëren.

> Vrijdagmiddagheld gevonden.

> Een groot glas brengt grote verantwoordelijkheid.

### 🎉 Speciale thema's

Incidenteel kan het rad een thema krijgen:

- Oktoberfest;
- kerst;
- carnaval;
- zomer;
- vrijdag de 13e;
- bedrijfsfeest.

Dit mag de basisinterface niet ingewikkelder maken.

### 📊 Historie

Eventueel lokaal bijhouden wie eerder gewonnen heeft.

Belangrijk:

Historische resultaten mogen **nooit de winkans beïnvloeden**.

Iedere trekking blijft volledig random.

Historie is alleen voor humor/statistieken.

---

# MVP

De eerste versie is geslaagd wanneer we op vrijdag:

1. Bierrad kunnen openen;
2. namen kunnen invoeren;
3. het aantal bierhalers kiezen en iedereen op elk rad zien;
4. alle raderen overtuigend en gelijktijdig kunnen laten draaien;
5. het gekozen aantal unieke willekeurige winnaars krijgen;
6. een leuke winnaarspresentatie zien;
7. opnieuw kunnen beginnen.

Daarna bouwen we Slack-integratie.

---

# North Star

Wanneer collega's vrijdag vragen:

**"Wie gaat bier halen?"**

moet het antwoord uiteindelijk niet zijn:

*"Kies maar wat mensen."*

Het antwoord moet zijn:

> **"Zet het Bierrad aan." 🍻🎡**

---

# Live Bierrad

**Live Bierrad is beschikbaar naast de zelfstandige lokale modus.**

Collega's kunnen op meerdere browsers en de kantoor-tv naar dezelfde live trekking kijken. Alle schermen tonen dezelfde deelnemers, draaien ongeveer gelijktijdig en stoppen bij dezelfde winnaars. Het gezamenlijke vrijdagmoment blijft centraal staan.

## Host en toeschouwers

Een host beheert handmatig de deelnemers, kiest het aantal bierhalers, start alle raderen tegelijk en kan de trekking resetten. Slack laden blijft toekomstwerk. Toeschouwers kijken alleen mee. Host en kijkers hebben verschillende tijdelijke links via URL-fragmenten; zonder geldige toegang zijn deelnemers niet zichtbaar. De sessie verloopt na acht uur of wanneer de host haar beëindigt. De kantoor-tv is een toeschouwer en hoeft geen bediening te tonen.

## Hetzelfde rad, één autoriteit

De server beheert de sessie, selecteert alle unieke winnaars en verstuurt één autoritatieve `DrawInstruction` naar alle schermen. Deze bevat de volledige segmentvolgorde, één gezamenlijke starttijd en meerdere `SpinInstruction`s met per rad een winnaar, duur en rotatie. Een instructie met vijf spins levert op het hostscherm, iedere spectator en de kantoor-tv dezelfde vijf raderen en dezelfde uitslag op. Clients visualiseren de uitslag; ze bepalen in Live Mode nooit zelfstandig een winnaar of volgende sessietoestand.

Een Cloudflare Worker met een Durable Object per sessie beheert livegegevens en WebSocket-verbindingen. De zelfstandige lokale versie werkt zonder backend. De server stuurt een trekking twee seconden voor de start uit; schermen corrigeren hun klok op basis van de server.

## Geplande vrijdagtrekkingen

Naast hostbediening kan later een automatische trekking bestaan, bijvoorbeeld op vrijdag om 15:30. De deelnemers zijn vooraf geladen, alle schermen tonen een countdown, alle raderen starten automatisch op de gedeelde starttijd en onthullen hun winnaars kort na elkaar. Tot slot verschijnen alle namen en kan de uitslag in de oorspronkelijke Slack-thread worden geplaatst.

Slack blijft de ingang voor deelname via `:beers:` en voor de uitslag. Slack-credentials blijven uitsluitend op de backend. Handmatige lokale deelname blijft altijd mogelijk.

## Later aansluiten

Een toeschouwer die tijdens het draaien opent, ontvangt de actuele sessie met de oorspronkelijke starttijd en volledige `DrawInstruction` met alle spins. Het scherm moet op het juiste punt instappen of een al voltooide uitslag tonen, zonder zelf opnieuw te loten. De remote controller schat het klokverschil, verbindt opnieuw met oplopende wachttijd en haalt de actuele serverstand op.

LocalSessionController en RemoteSessionController gebruiken dezelfde radcomponenten. Meerdere kijkers, tijdelijke host-/kijkrechten, WebSockets en herstel na verbindingsverlies zijn geïmplementeerd. Gebruikersaccounts, automatische planning en Slack blijven toekomstwerk. Een deelbare link verleent tijdelijke toegang en is geen volledige gebruikersauthenticatie.
