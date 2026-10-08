import { roundCopy, type ChannelApp } from "../../shared/channel";
import { reviewLabels } from "../../shared/reviews";
import { themes, type WheelVariant } from "../../shared/variant";

/** Made-up colleagues: the explainer never shows real people or channels. */
const names = ["Nick", "Alice", "Bob"] as const;
const beerNames = ["Nick", "Alice", "Bob", "Sanne", "Daan"] as const;
const winner = names[0];

/** A static wheel picture: equal slices, the theme's colours, no draw. */
function Wheel({ people, variant }: { people: readonly string[]; variant: WheelVariant }) {
  const colors = themes[variant].wheelColors ?? [
    "#f4b942",
    "#e9784f",
    "#7f9c8b",
    "#f2d98b",
    "#a99bc4",
  ];
  // Narrower slices put their names further out.
  const r = people.length > 3 ? 34 : 30;
  return (
    <svg className="explainer-wheel" viewBox="0 0 120 120">
      {people.map((name, i) => {
        const a = (i * 2 * Math.PI) / people.length - Math.PI / 2;
        const b = ((i + 1) * 2 * Math.PI) / people.length - Math.PI / 2;
        const m = (a + b) / 2;
        return (
          <g key={name}>
            <path
              d={`M60 60 L${60 + 52 * Math.cos(a)} ${60 + 52 * Math.sin(a)} A52 52 0 0 1 ${60 + 52 * Math.cos(b)} ${60 + 52 * Math.sin(b)} Z`}
              fill={colors[i % colors.length]}
            />
            <text x={60 + r * Math.cos(m)} y={60 + r * Math.sin(m)}>
              {name}
            </text>
          </g>
        );
      })}
      <circle className="explainer-rim" cx="60" cy="60" r="52" />
      <circle className="explainer-hub" cx="60" cy="60" r="7" />
      <path className="explainer-pointer" d="M53 2 H67 L60 15 Z" />
    </svg>
  );
}

/**
 * How a channel round goes, from slash command to review, as static
 * pictures. Display only: no network, no draw and not the real wheel.
 */
export function RoundExplainer({ app = "coffee" }: { app?: ChannelApp }) {
  return app === "beer" ? <BeerExplainer /> : <CoffeeExplainer />;
}

function CoffeeExplainer() {
  const theme = themes.coffee;
  const round = roundCopy("coffee").round;
  const title = `${theme.icon} ${round[0].toUpperCase()}${round.slice(1)} om 10:05`;
  const labels = reviewLabels.coffee;
  return (
    <section className="round-explainer" aria-labelledby="round-explainer-title">
      <h2 id="round-explainer-title">Zo gaat een {round}</h2>
      <ol>
        <li>
          <h3>Aanvragen</h3>
          <p>
            Typ <code>/koffierad 5</code> in het kanaal: over vijf minuten draait
            het rad.
          </p>
          <div className="explainer-shot" aria-hidden="true">
            <div className="explainer-input">
              /koffierad 5<span className="explainer-caret" />
            </div>
          </div>
        </li>
        <li>
          <h3>Aanmelden</h3>
          <p>
            Het {theme.name} plaatst een oproep. Wie op {theme.icon} klikt, doet
            mee.
          </p>
          <div className="explainer-shot" aria-hidden="true">
            <div className="explainer-message">
              <strong>{title}</strong>
              <span>Klik op {theme.icon} hieronder om mee te doen.</span>
              <span className="explainer-link">Kijk live mee</span>
              <span className="explainer-reaction">{theme.icon} 3</span>
            </div>
          </div>
        </li>
        <li>
          <h3>Draaien</h3>
          <p>
            Na de wachttijd draait het rad vanzelf op het scherm van het kanaal.
          </p>
          <div className="explainer-shot" aria-hidden="true">
            <Wheel people={names} variant="coffee" />
            <span className="explainer-count">nog 0:12</span>
          </div>
        </li>
        <li>
          <h3>Winnaar</h3>
          <p>
            De oproep wordt de uitslag. De winnaar krijgt een @vermelding in de
            thread.
          </p>
          <div className="explainer-shot" aria-hidden="true">
            <div className="explainer-message">
              <strong>{title}</strong>
              <span>
                🏆 <span className="explainer-mention">@{winner}</span> haalt{" "}
                {theme.drink}
              </span>
              <small>3 deden mee</small>
            </div>
          </div>
        </li>
        <li>
          <h3>Beoordelen</h3>
          <p>
            Wie meedeed, geeft de haler anoniem 1 tot 5 sterren, van{" "}
            <em>{labels[0]}</em> tot <em>{labels[4]}</em>.
          </p>
          <div className="explainer-shot" aria-hidden="true">
            <div className="explainer-ballot">
              <span className="explainer-stars">
                ★★★★<span>★</span>
              </span>
              <small>{labels[3]}</small>
              <span>
                🏆 {winner} haalde {theme.drink} · ⭐ 4.3
              </span>
            </div>
          </div>
        </li>
      </ol>
    </section>
  );
}

/** The Bierrad's `/bierrad` round: its fixed call, the reminder and two halers. */
function BeerExplainer() {
  const theme = themes.beer;
  const labels = reviewLabels.beer;
  const [first, second] = beerNames;
  return (
    <section
      className="round-explainer six-steps"
      aria-labelledby="round-explainer-title"
    >
      <h2 id="round-explainer-title">Zo gaat een bierronde</h2>
      <ol>
        <li>
          <h3>Aanvragen</h3>
          <p>
            Typ <code>/bierrad</code> in het kanaal: dan draait het rad vandaag
            om 15:45. Een dag, tijd, aantal of eigen tekst mag erachter.
          </p>
          <div className="explainer-shot" aria-hidden="true">
            <div className="explainer-input">
              /bierrad vrijdag 15.45 Proost!
              <span className="explainer-caret" />
            </div>
          </div>
        </li>
        <li>
          <h3>Aanmelden</h3>
          <p>
            Het {theme.name} plaatst de oproep. Wie op {theme.icon} klikt, doet
            mee; „radje” opent de ronde.
          </p>
          <div className="explainer-shot" aria-hidden="true">
            <div className="explainer-message">
              <span>Proost!</span>
              <strong>{theme.icon} 🎡 Het bierronde radje 🎡 {theme.icon}</strong>
              <span>
                Reageer met een {theme.icon} om kans te maken de bierronde te
                lopen!
              </span>
              <span>
                🌀 Het <span className="explainer-link">radje</span> gaat
                draaien om 15:45! 🌀
              </span>
              <span className="explainer-reaction">{theme.icon} 5</span>
            </div>
          </div>
        </li>
        <li>
          <h3>Herinnering</h3>
          <p>
            Twee minuten vooraf zet de bot in de thread de links om in te
            loggen of alleen mee te kijken.
          </p>
          <div className="explainer-shot" aria-hidden="true">
            <div className="explainer-message">
              <strong>⏰ Over 2 minuten draait het radje! {theme.icon}</strong>
              <span>
                <span className="explainer-link">Inloggen</span> of{" "}
                <span className="explainer-link">alleen meekijken</span>
              </span>
            </div>
          </div>
        </li>
        <li>
          <h3>Draaien</h3>
          <p>
            Op de gekozen tijd draaien de raderen vanzelf, één per haler:
            standaard twee.
          </p>
          <div className="explainer-shot" aria-hidden="true">
            <Wheel people={beerNames} variant="beer" />
            <span className="explainer-count">2 halers · nog 0:12</span>
          </div>
        </li>
        <li>
          <h3>Winnaars</h3>
          <p>
            De oproep wordt de uitslag. De halers krijgen een @vermelding in de
            thread.
          </p>
          <div className="explainer-shot" aria-hidden="true">
            <div className="explainer-message">
              <strong>{theme.icon} Bierronde om 15:45</strong>
              <span>
                🏆 <span className="explainer-mention">@{first}</span> ·{" "}
                <span className="explainer-mention">@{second}</span> halen{" "}
                {theme.drink}
              </span>
              <small>5 deden mee</small>
            </div>
          </div>
        </li>
        <li>
          <h3>Beoordelen</h3>
          <p>
            Wie meedeed, geeft de halers anoniem 1 tot 5 sterren, van{" "}
            <em>{labels[0]}</em> tot <em>{labels[4]}</em>.
          </p>
          <div className="explainer-shot" aria-hidden="true">
            <div className="explainer-ballot">
              <span className="explainer-stars">
                ★★★★<span>★</span>
              </span>
              <small>{labels[3]}</small>
              <span>
                🏆 {first} ⭐ 4.5 · {second} ⭐ 4.0
              </span>
            </div>
          </div>
        </li>
      </ol>
    </section>
  );
}
