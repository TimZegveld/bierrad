import { useEffect, useId, useRef } from "react";
export function RatingDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="rating-dialog"
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <button
        className="rating-close"
        aria-label="Beoordeling sluiten"
        onClick={onClose}
      >
        ×
      </button>
      <span className="rating-dialog-badge" aria-hidden="true">
        ★
      </span>
      <p className="eyebrow">EEN RONDJE WAARDERING</p>
      <h2 id={id}>{title}</h2>
      {children}
    </dialog>
  );
}
