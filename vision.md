# 🍻🎡 Bierrad — Product Vision

## Waarom bestaat Bierrad?

Elke vrijdag is er maar één vraag die er echt toe doet:

**Wie haalt het bier?**

Bierrad maakt van die simpele vraag een klein wekelijks evenement.

In plaats van twee namen willekeurig uit een lijst te trekken, maken we er bewust een moment van. Collega's melden zich aan, het rad verschijnt op het scherm, iedereen kijkt mee en twee ongelukkige — of gelukkige — collega's worden door het lot aangewezen.

Bierrad moet vooral **leuk** zijn.

Het is geen enterprise-tool.  
Het is geen HR-systeem.  
Het is geen generieke random-name-picker.

Het is:

> **Het officiële, totaal onnodig spectaculaire systeem om te bepalen wie vrijdag het bier haalt.**

---

# Kernervaring

De ideale vrijdagmiddag ziet er zo uit:

1. In Slack verschijnt het wekelijkse bericht over de bierronde.
2. Collega's die meedoen reageren met `:beers:`.
3. Iemand opent Bierrad op een groot scherm.
4. Bierrad haalt de deelnemers uit Slack.
5. Alle namen verschijnen op het rad.
6. Iedereen kan controleren of hij/zij erop staat.
7. Er wordt op de grote knop gedrukt.
8. Het rad begint te draaien.
9. De spanning loopt op.
10. Het rad stopt bij de eerste winnaar.
11. Die persoon verdwijnt uit het rad.
12. Het rad draait opnieuw.
13. De tweede winnaar wordt gekozen.
14. Bierrad presenteert beide winnaars feestelijk.
15. De uitslag wordt in dezelfde Slack-thread geplaatst.

Het hele proces moet binnen ongeveer een minuut kunnen plaatsvinden.

Maar die minuut mag wel voelen alsof de WK-finale wordt beslist.

---

# Productprincipes

## 1. Fun boven efficiëntie

Technisch gezien kunnen we twee willekeurige namen in minder dan een milliseconde selecteren.

Dat is niet het doel.

Het draaien van het rad **is onderdeel van het product**.

Animatie, spanning, humor en presentatie zijn belangrijker dan maximale efficiëntie.

---

## 2. Het lot bepaalt

De selectie moet daadwerkelijk willekeurig zijn.

De winnaar wordt vóór de animatie bepaald met betrouwbare browser-randomness, bijvoorbeeld:

```typescript
crypto.getRandomValues()
```

De animatie visualiseert vervolgens die uitslag.

De animatie zelf mag nooit bepalen wie wint.

Daardoor kunnen we garanderen dat:

- iedereen dezelfde kans heeft;
- de animatie de uitslag niet beïnvloedt;
- dezelfde persoon niet twee keer wordt gekozen.

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

# Twee winnaars

Bierrad kiest altijd twee verschillende personen.

## Ronde 1

Voor het draaien:

> 🍺 Wie haalt het eerste rondje?

Daarna:

> 🎉 TIM! 🎉

De eerste winnaar krijgt kort zijn eigen moment.

Daarna verschijnt:

**Draai voor nummer 2**

## Ronde 2

De eerste winnaar wordt uit het actieve rad verwijderd.

Daarna:

> 🍺 Wie wordt slachtoffer nummer twee?

Het rad draait opnieuw.

Na afloop worden beide namen samen gepresenteerd.

---

# Finale

De finale moet groter aanvoelen dan de individuele trekkingen.

Bijvoorbeeld:

> # 🍻 HET RAD HEEFT GESPROKEN! 🍻
>
> ## TIM & JAN
>
> **Jullie mogen bier halen!**

Met confetti en een duidelijke feestelijke animatie.

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
- direct het rad starten.

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
> 🍺 Jan
>
> Succes heren/dames. Het volk heeft dorst.

De toon mag speels zijn en kan later eventueel variëren.

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

Het rad weet daardoor niet waar deelnemers vandaan komen.

Het krijgt simpelweg:

```typescript
Participant[]
```

en doet zijn werk.

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
3. iedereen op een duidelijk rad zien;
4. het rad overtuigend kunnen laten draaien;
5. twee verschillende willekeurige winnaars krijgen;
6. een leuke winnaarspresentatie zien;
7. opnieuw kunnen beginnen.

Daarna bouwen we Slack-integratie.

---

# North Star

Wanneer collega's vrijdag vragen:

**"Wie gaat bier halen?"**

moet het antwoord uiteindelijk niet zijn:

*"Kies maar twee mensen."*

Het antwoord moet zijn:

> **"Zet het Bierrad aan." 🍻🎡**

---

# Live Bierrad

**Future vision — not part of the current MVP.**

In een toekomstige versie kunnen collega's op meerdere browsers en de kantoor-tv naar dezelfde live trekking kijken. Alle schermen tonen dezelfde deelnemers, draaien ongeveer gelijktijdig en stoppen bij dezelfde winnaars. Het gezamenlijke vrijdagmoment blijft centraal staan.

## Host en toeschouwers

Een host beheert de deelnemers, kan ze uit Slack laden, start beide rondes en kan de trekking resetten. Toeschouwers kijken alleen mee. Een toekomstige hostweergave en liveweergave kunnen bijvoorbeeld `/host` en `/live` krijgen. De kantoor-tv is een toeschouwer en hoeft geen bediening te tonen.

## Hetzelfde rad, één autoriteit

De server beheert de sessie, selecteert de winnaars en verstuurt dezelfde deterministische draai-instructie naar alle schermen: segmentvolgorde, winnaar, starttijd, duur en rotatie. Clients visualiseren de uitslag; ze bepalen in Live Mode nooit zelfstandig een winnaar of volgende sessietoestand.

Een kleine Cloudflare Worker met een Durable Object per sessie en WebSocket-verbindingen is een mogelijke toekomstige invulling. Dit is nog geen infrastructuurkeuze die de lokale versie nodig heeft.

## Geplande vrijdagtrekkingen

Naast hostbediening kan later een automatische trekking bestaan, bijvoorbeeld op vrijdag om 15:30. De deelnemers zijn vooraf geladen, alle schermen tonen een countdown, de eerste draai start automatisch, de winnaar krijgt een kort moment en daarna volgt de tweede draai. Tot slot verschijnen beide namen en kan de uitslag in de oorspronkelijke Slack-thread worden geplaatst.

Slack blijft de ingang voor deelname via `:beers:` en voor de uitslag. Slack-credentials blijven uitsluitend op de backend. Handmatige lokale deelname blijft altijd mogelijk.

## Later aansluiten

Een toeschouwer die tijdens het draaien opent, ontvangt de actuele sessie met de oorspronkelijke starttijd en volledige draai-instructie. Het scherm moet op het juiste punt instappen of een al voltooide uitslag tonen, zonder zelf opnieuw te loten. Klokverschillen en herverbindingen vragen later om synchronisatie op basis van de serverklok.

De huidige architectuur bereidt hiervoor sessiecontrollers, gedeelde domeinmodellen, capabilities en tijdgestuurde animatie-instructies voor. Multi-user sessies, WebSockets, automatische planning, authenticatie en de Slack-backend vallen buiten de huidige MVP.
