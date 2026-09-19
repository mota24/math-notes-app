import { useState } from 'react';
import type { Block } from '../ai/blocks';
import type { ConversionResult, Transcript } from '../db/schema';
import { BlocksView } from '../render/BlocksView';
import { blocksToLatex, latexDocument } from '../render/math';
import { TranscriptEditor } from './TranscriptEditor';

const SOURCE_LABEL = { selection: 'Sélection', page: 'Page', image: 'Image importée' } as const;
const SETTINGS_KINDS = ['key', 'quota', 'rate', 'model', 'overloaded'];

export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* on tente la méthode de secours */
  }
  // En http:// sur le réseau local, l'API presse-papiers moderne est bloquée
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (what: string, text: string) => {
    const ok = await copyText(text);
    setCopied(ok ? what : null);
    window.setTimeout(() => setCopied(null), 1600);
  };
  return { copied, copy };
}

function TranscriptSection(props: {
  transcript: Transcript | undefined;
  strokeCount: number;
  hasBackground: boolean;
  busy: string | null;
  error: { message: string; kind: string } | null;
  onConvert(): void;
  onSave(blocks: Block[]): void;
  onOpenSettings(): void;
  onInsert(blocks: Block[]): void | Promise<void>;
}) {
  const { transcript, busy, error } = props;
  const [editing, setEditing] = useState(false);
  const [inserting, setInserting] = useState(false);
  const { copied, copy } = useCopy();

  if (editing) {
    return (
      <TranscriptEditor
        blocks={transcript?.blocks ?? []}
        onCancel={() => setEditing(false)}
        onSave={(blocks) => {
          props.onSave(blocks);
          setEditing(false);
        }}
      />
    );
  }
  const reconvert = () => {
    if (!transcript?.edited || window.confirm('Reconvertir remplacera tes corrections. Continuer ?')) props.onConvert();
  };

  return (
    <section className="card transcript">
      <header className="card-head">
        <span className="badge">Transcription de la page</span>
        {transcript && (
          <span className="meta">
            {transcript.edited ? 'corrigée · ' : ''}
            {transcript.model}
          </span>
        )}
      </header>
      {busy && (
        <p className="loading">
          <span className="spinner" /> {busy}
        </p>
      )}
      {!busy && error && (
        <div className="error">
          <p>{error.message}</p>
          <div className="row">
            <button onClick={props.onConvert}>Réessayer</button>
            {SETTINGS_KINDS.includes(error.kind) && <button onClick={props.onOpenSettings}>Réglages</button>}
          </div>
        </div>
      )}
      {!busy && !transcript && !error && (
        <div className="panel-empty">
          <p>
            {props.hasBackground
              ? 'Gemini peut lire le PDF ou la photo de cette page, avec tes annotations.'
              : 'Cette page n’est pas encore convertie en LaTeX.'}
          </p>
          <div className="row">
            <button className="primary" onClick={props.onConvert}>
              Convertir la page
            </button>
            <button onClick={() => setEditing(true)}>Écrire ou coller le texte</button>
          </div>
          <p className="hint">
            Pour une seule formule : entoure-la avec le <strong>lasso</strong> puis « Convertir en LaTeX ». Les passages dont Gemini
            n’est pas sûr sont surlignés en jaune. « Écrire ou coller » accepte aussi une réponse copiée depuis ChatGPT, pour
            l’exporter en manuscrit.
          </p>
        </div>
      )}
      {transcript && !busy && (
        <>
          {transcript.strokeCount !== props.strokeCount && !transcript.edited && (
            <p className="stale">
              La page a changé depuis la conversion. <button onClick={props.onConvert}>Reconvertir</button>
            </p>
          )}
          <BlocksView blocks={transcript.blocks} />
          <div className="row card-actions">
            <button
              className="primary"
              disabled={inserting}
              onClick={async () => {
                setInserting(true);
                try {
                  await props.onInsert(transcript.blocks);
                } finally {
                  setInserting(false);
                }
              }}
            >
              {inserting ? 'Pose en cours…' : 'Poser sur la page'}
            </button>
            <button onClick={() => setEditing(true)}>Corriger</button>
            <button onClick={() => void copy('body', blocksToLatex(transcript.blocks))}>{copied === 'body' ? 'Copié ✓' : 'Copier le LaTeX'}</button>
            <button onClick={reconvert}>Reconvertir</button>
          </div>
        </>
      )}
    </section>
  );
}

function ResultCard({
  r,
  onRetry,
  onDelete,
  onOpenSettings,
  onInsert,
}: {
  r: ConversionResult;
  onRetry(id: string): void;
  onDelete(id: string): void;
  onOpenSettings(): void;
  onInsert(blocks: Block[]): void | Promise<void>;
}) {
  const [showCode, setShowCode] = useState(false);
  const [inserting, setInserting] = useState(false);
  const { copied, copy } = useCopy();
  const time = new Date(r.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return (
    <article className={`card card-${r.status}`}>
      <header className="card-head">
        <span className="badge">{SOURCE_LABEL[r.source]}</span>
        <span className="meta">
          {time} · {r.model}
          {r.durationMs ? ` · ${(r.durationMs / 1000).toFixed(1)} s` : ''}
        </span>
        <button className="icon-btn" onClick={() => onDelete(r.id)} aria-label="Supprimer ce résultat">
          ✕
        </button>
      </header>

      {r.status === 'loading' && (
        <p className="loading">
          <span className="spinner" /> {r.progress ?? 'Gemini lit ton écriture…'}
        </p>
      )}
      {r.status === 'error' && (
        <div className="error">
          <p>{r.error}</p>
          <div className="row">
            <button onClick={() => onRetry(r.id)}>Réessayer</button>
            {SETTINGS_KINDS.includes(r.errorKind ?? '') && <button onClick={onOpenSettings}>Réglages</button>}
          </div>
        </div>
      )}
      {r.status === 'done' && r.blocks && (
        <>
          <BlocksView blocks={r.blocks} />
          <div className="row card-actions">
            <button
              className="primary"
              disabled={inserting}
              onClick={async () => {
                setInserting(true);
                try {
                  await onInsert(r.blocks!);
                } finally {
                  setInserting(false);
                }
              }}
            >
              {inserting ? 'Pose en cours…' : 'Poser sur la page'}
            </button>
            <button onClick={() => void copy('body', blocksToLatex(r.blocks!))}>{copied === 'body' ? 'Copié ✓' : 'Copier le LaTeX'}</button>
            <button onClick={() => setShowCode((v) => !v)}>{showCode ? 'Masquer le code' : 'Voir le code'}</button>
          </div>
          {showCode && (
            <div className="code-box">
              <pre>{latexDocument(r.blocks)}</pre>
              <button onClick={() => void copy('doc', latexDocument(r.blocks!))}>
                {copied === 'doc' ? 'Copié ✓' : 'Copier le document complet (Overleaf)'}
              </button>
            </div>
          )}
        </>
      )}

      <details className="sent-image">
        <summary>Image envoyée</summary>
        <img src={r.imageDataUrl} alt="Zone envoyée à Gemini" />
      </details>
    </article>
  );
}

export function ResultsPanel(props: {
  transcript: Transcript | undefined;
  strokeCount: number;
  hasBackground: boolean;
  transcriptBusy: string | null;
  transcriptError: { message: string; kind: string } | null;
  onConvertPage(): void;
  onSaveTranscript(blocks: Block[]): void;
  results: ConversionResult[];
  onRetry(id: string): void;
  onDelete(id: string): void;
  onOpenSettings(): void;
  onInsert(blocks: Block[]): void | Promise<void>;
}) {
  return (
    <div className="results">
      <TranscriptSection
        transcript={props.transcript}
        strokeCount={props.strokeCount}
        hasBackground={props.hasBackground}
        busy={props.transcriptBusy}
        error={props.transcriptError}
        onConvert={props.onConvertPage}
        onSave={props.onSaveTranscript}
        onOpenSettings={props.onOpenSettings}
        onInsert={props.onInsert}
      />
      {props.results.length > 0 && <h3 className="results-title">Conversions ponctuelles</h3>}
      {props.results.map((r) => (
        <ResultCard key={r.id} r={r} onRetry={props.onRetry} onDelete={props.onDelete} onOpenSettings={props.onOpenSettings} onInsert={props.onInsert} />
      ))}
    </div>
  );
}
