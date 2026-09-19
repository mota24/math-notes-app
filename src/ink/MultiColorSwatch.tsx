import { useEffect, useRef } from 'react';

/**
 * Pastille « multicolore » : ouvre le sélecteur de couleur du système, pour choisir n'importe quelle
 * teinte. La couleur n'est validée qu'à la fermeture du sélecteur (événement natif `change`). Le
 * `onChange` de React, lui, part à chaque déplacement du curseur dans le sélecteur : chaque teinte
 * traversée serait prise pour un choix et ferait défiler toute la palette.
 */
export function MultiColorSwatch({ initial, onCommit }: { initial: string; onCommit(color: string): void }) {
  const input = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const onChange = () => commit.current(el.value);
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);

  return (
    <label className="swatch small custom" title="Autre couleur : choisis n’importe quelle teinte">
      <input ref={input} type="color" defaultValue={initial} aria-label="Autre couleur" />
    </label>
  );
}
