import type { Participant } from "../types";
export function WinnerAnnouncement({ winner }: { winner: Participant }) {
  return (
    <div className="winner-announcement" role="status">
      <span>DE EERSTE BIERHALER IS BEKEND</span>
      <h2>🎉 {winner.name} 🎉</h2>
      <p>Eén collega gaat nog met je mee…</p>
    </div>
  );
}
