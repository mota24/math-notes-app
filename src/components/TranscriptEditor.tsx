import { useDeferredValue, useMemo, useState } from 'react';
import type { Block } from '../ai/blocks';
import { blocksToText, textToBlocks } from '../ai/notesText';
import { BlocksView } from '../render/BlocksView';

/** Correction d'une transcription : texte simple + aperçu en direct. */
export function TranscriptEditor({ blocks, onSave, onCancel }: { blocks: Block[]; onSave(blocks: Block[]): void; onCancel(): void }) {
  const [text, setText] = useState(() => blocksToText(blocks));
  const deferred = useDeferredValue(text);
  const preview = useMemo(() => textToBlocks(deferred), [deferred]);

  return (
    <section className="card transcript-editor">
      <header className="card-head">
        <span className="badge">Modifier la transcription</span>
      </header>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={14} />
      <details className="syntax-help">
        <summary>Syntaxe</summary>
        <ul>
          <li>
            <code># Titre</code>
          </li>
          <li>
            Texte avec formule : <code>{'Soit $f(x) = x^2$'}</code>
          </li>
          <li>
            Formule centrée : <code>$$</code> sur une ligne, la formule, puis <code>$$</code>
          </li>
          <li>
            Liste : <code>- élément</code>
          </li>
          <li>
            Tableau de variations : <code>```tableau</code> … code tkz-tab … <code>```</code>
          </li>
          <li>
            Passage douteux : <code>[?texte?]</code> ou <code>{'\\unsure{x}'}</code>
          </li>
          <li>
            <code>[figure] description</code>
          </li>
        </ul>
      </details>
      <div className="row">
        <button onClick={onCancel}>Annuler</button>
        <button className="primary" onClick={() => onSave(textToBlocks(text))}>
          Enregistrer
        </button>
      </div>
      <h4 className="preview-title">Aperçu</h4>
      <BlocksView blocks={preview} />
    </section>
  );
}
