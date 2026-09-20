import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { InkStats } from '../../ink/InkCanvas';
import { liveStats } from '../../ink/liveStats';
import type { SizeMode, TrackInfo } from '../../ink/palm';
import type { Handedness, StylusMode } from '../../ink/types';
import type { Settings } from '../../settings';
import { ICONS } from '../icons';

const STATE_LABEL: Record<string, string> = { pending: 'En attente', draw: 'Écrit', palm: 'Ignoré', gesture: 'Geste' };
const STYLUS_MODES: { value: StylusMode; label: string; hint: string }[] = [
  { value: 'active', label: 'Stylet actif strict (recommandé)', hint: 'Seul le stylet actif (S Pen, EMR) écrit ou gomme. Les doigts et la paume sont réservés au défilement et au zoom : aucun trait parasite.' },
  { value: 'finger', label: 'Tout contact (tactile / souris)', hint: 'Tout contact écrit sur la page : pratique pour tester au doigt ou à la souris sur ordinateur.' },
];
const REST_ZONES = [
  { value: 0, label: 'Aucune' },
  { value: 0.25, label: 'Quart' },
  { value: 0.35, label: 'Tiers' },
  { value: 0.45, label: 'Moitié' },
];
/** Écart minimal (px) entre les deux mesures pour qu'un seuil fiable puisse être posé entre elles. */
const MIN_GAP = 15;

interface Snapshot {
  type: string;
  pressure: number;
  size: number;
  eventsPerSec: number;
  cancels: number;
  lowLatency: boolean;
  tracks: TrackInfo[];
  decisions: string[];
  learnedPenSize: number | null;
  penReference: number | null;
  palmThreshold: number | null;
  maxSize: number;
  /** Plus gros contact visible en ce moment : sert au calibrage */
  liveMax: number;
}

/**
 * Anti-paume : réglages et, quand un cahier est ouvert (le canevas publie ses stats dans
 * `liveStats`), le calibrage et le diagnostic en direct — plus de panneau flottant sur la page,
 * tout vit ici pour que la barre d'outils reste entièrement dédiée au dessin.
 */
export function AntiPalmSection({ settings, update }: { settings: Settings; update(patch: Partial<Settings>): void }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [measure, setMeasure] = useState<{ pen: number | null; palm: number | null }>({ pen: null, palm: null });

  const capture = (what: 'pen' | 'palm') => {
    const size = snap?.liveMax ?? 0;
    if (!size) return;
    const next = { ...measure, [what]: size };
    if (next.pen && next.palm && next.palm - next.pen >= MIN_GAP) {
      update({ sizeMode: 'manual', palmSize: Math.round((next.pen + next.palm) / 2), penSizePx: next.pen });
      setMeasure({ pen: null, palm: null });
    } else {
      setMeasure(next);
    }
  };
  const tooClose = measure.pen !== null && measure.palm !== null && measure.palm - measure.pen < MIN_GAP;
  const resetMeasure = () => setMeasure({ pen: null, palm: null });
  const calibrated = settings.sizeMode === 'manual' && measure.pen === null && measure.palm === null;

  useEffect(() => {
    let maxSize = 0;
    const id = window.setInterval(() => {
      const s: InkStats | null = liveStats.current;
      if (!s) return;
      const info = s.inspect();
      let liveMax = 0;
      for (const t of info.tracks) {
        maxSize = Math.max(maxSize, t.size);
        liveMax = Math.max(liveMax, t.size);
      }
      setSnap({ liveMax, type: s.type, pressure: s.pressure, size: s.size, eventsPerSec: s.eventsPerSec, cancels: s.cancels, lowLatency: s.lowLatency, ...info, maxSize });
    }, 150);
    return () => window.clearInterval(id);
  }, []);

  const mode = STYLUS_MODES.find((m) => m.value === settings.stylusMode);

  return (
    <section>
      <h3>
        <span className="palm-badge">{ICONS.shield}</span> Stylet et saisie tactile
      </h3>
      <p className="hint">Le rejet de paume est assuré par le système d'exploitation de ta tablette. L'application accepte tous les contacts de la même façon et se concentre sur la détection des gestes à deux doigts (défilement, zoom).</p>

      <span className="field-label">Calibrer les tailles</span>
      {calibrated ? (
        <div className="calib-done">
          <p>
            <strong>Seuil réglé : {settings.palmSize} px.</strong> Tout contact plus gros ne peut plus jamais écrire, sans
            exception (stylet mesuré à {settings.penSizePx} px).
          </p>
          <button onClick={resetMeasure}>Recalibrer</button>
          <button className="link" onClick={() => update({ sizeMode: 'auto' })}>
            revenir à l’automatique
          </button>
        </div>
      ) : (
        <>
          <p className="hint">
            Ouvre un cahier, pose ton stylet seul sur l’écran et appuie sur « Mesurer mon stylet », puis pose ta paume seule
            (rien d’autre) et appuie sur « Mesurer ma paume ». Le seuil se règle aussitôt entre les deux.
          </p>
          <div className="calib-buttons">
            <button className={`calib-btn ${measure.pen !== null ? 'done' : ''}`} onClick={() => capture('pen')} disabled={!snap?.liveMax}>
              {ICONS.pen}
              <span>{measure.pen !== null ? `Stylet · ${measure.pen} px` : 'Mesurer mon stylet'}</span>
            </button>
            <button className={`calib-btn ${measure.palm !== null ? 'done' : ''}`} onClick={() => capture('palm')} disabled={!snap?.liveMax}>
              {ICONS.hand}
              <span>{measure.palm !== null ? `Paume · ${measure.palm} px` : 'Mesurer ma paume'}</span>
            </button>
          </div>
          <p className="calib-live">
            {snap?.liveMax ? (
              <>
                Contact posé là, maintenant : <strong>{snap.liveMax} px</strong>
              </>
            ) : (
              'Un cahier doit être ouvert et un doigt, ton stylet ou ta paume posé pour voir sa taille ici.'
            )}
          </p>
          {tooClose && (
            <p className="calib-warn">
              Ces deux tailles sont trop proches ({measure.pen} et {measure.palm} px) pour poser un seuil fiable. Remesure,
              en t’assurant qu’un seul contact touche l’écran à chaque fois.{' '}
              <button className="link" onClick={resetMeasure}>
                recommencer
              </button>
            </p>
          )}
          {settings.sizeMode === 'manual' && (
            <p className="hint">
              Seuil manuel actuel : <strong>{settings.palmSize} px</strong>.{' '}
              <button className="link" onClick={() => update({ sizeMode: 'auto' })}>
                revenir à l’automatique
              </button>
            </p>
          )}
        </>
      )}

      <label className="field">
        <span>Type de stylet</span>
        <select value={settings.stylusMode} onChange={(e) => update({ stylusMode: e.target.value as StylusMode })}>
          {STYLUS_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <small>{mode?.hint}</small>
      </label>
      <label className="field">
        <span>Main d’écriture</span>
        <select value={settings.handedness} onChange={(e) => update({ handedness: e.target.value as Handedness })}>
          <option value="right">Droite</option>
          <option value="left">Gauche</option>
        </select>
        <small>Les commandes de pagination se placent dans la marge du côté opposé, loin de ta paume.</small>
      </label>
      <label className="field">
        <span>Taille des contacts</span>
        <select value={settings.sizeMode} onChange={(e) => update({ sizeMode: e.target.value as SizeMode })}>
          <option value="auto">Automatique : apprise sur tes traits</option>
          <option value="manual">Seuil manuel</option>
          <option value="off">Ignorée (mouvement uniquement)</option>
        </select>
        <small>Filtre supplémentaire : un contact nettement plus gros que ton stylet est écarté d'office.</small>
      </label>
      {settings.sizeMode === 'manual' && (
        <label className="field">
          <span>
            Au-delà de <strong>{settings.palmSize} px</strong>, c'est une paume
          </span>
          <input type="range" min={20} max={600} step={5} value={settings.palmSize} onChange={(e) => update({ palmSize: Number(e.target.value) })} />
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={settings.lockBigStill} onChange={(e) => update({ lockBigStill: e.target.checked })} />
        Ignorer totalement les gros contacts posés (ta paume n'écrit plus tant que tu ne lèves pas la main)
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.holdEraser} onChange={(e) => update({ holdEraser: e.target.checked })} />
        Appui long = gomme (pose le stylet sans bouger {(settings.holdMs / 1000).toFixed(1)} s)
      </label>
      {settings.holdEraser && (
        <input
          type="range"
          className="slider"
          min={400}
          max={1500}
          step={50}
          value={settings.holdMs}
          onChange={(e) => update({ holdMs: Number(e.target.value) })}
          style={{ '--fill': `${((settings.holdMs - 400) / 1100) * 100}%` } as CSSProperties}
          aria-label="Durée de l’appui long avant la gomme, en millisecondes"
        />
      )}
      <label className="check">
        <input type="checkbox" checked={settings.shapeHold} onChange={(e) => update({ shapeHold: e.target.checked })} />
        Dessiner → maintenir → ajuster (forme parfaite après {(settings.shapeHoldMs / 1000).toFixed(1)} s d'appui en fin de trait)
      </label>
      {settings.shapeHold && (
        <input
          type="range"
          className="slider"
          min={200}
          max={800}
          step={25}
          value={settings.shapeHoldMs}
          onChange={(e) => update({ shapeHoldMs: Number(e.target.value) })}
          style={{ '--fill': `${((settings.shapeHoldMs - 200) / 600) * 100}%` } as CSSProperties}
          aria-label="Durée de l’appui long avant la reconnaissance de forme, en millisecondes"
        />
      )}
      <label className="field">
        <span>
          Un contact est « posé » au bout de <strong>{settings.staticAfter} ms</strong>
        </span>
        <input
          type="range"
          min={150}
          max={800}
          step={50}
          value={settings.staticAfter}
          onChange={(e) => update({ staticAfter: Number(e.target.value) })}
        />
        <small>Plus court = la paume est écartée plus vite ; plus long = un stylet qui hésite avant de partir écrit encore.</small>
      </label>
      <label className="field">
        <span>Zone de repos pour la main</span>
        <select value={settings.restZone} onChange={(e) => update({ restZone: Number(e.target.value) })}>
          {REST_ZONES.map((z) => (
            <option key={z.value} value={z.value}>
              {z.label}
            </option>
          ))}
        </select>
        <small>Solution de secours infaillible : rien ne s'écrit dans cette bande, en bas de la page.</small>
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.lowLatency} onChange={(e) => update({ lowLatency: e.target.checked })} />
        Latence réduite (expérimental : si la zone d'écriture devient noire, décoche)
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.showContacts} onChange={(e) => update({ showContacts: e.target.checked })} />
        Dessiner les contacts et leur décision sur la page (utile pour régler l'anti-paume)
      </label>

      <span className="field-label">Diagnostic en direct</span>
      <div className="stat-row">
        <span className="stat">
          <b>{snap?.penReference == null ? '—' : `${snap.penReference} px`}</b>
          <small>stylet {settings.sizeMode === 'manual' ? 'calibré' : snap?.learnedPenSize == null ? 'estimé' : 'appris'}</small>
        </span>
        <span className="stat">
          <b>{snap?.palmThreshold == null ? '—' : `${snap.palmThreshold} px`}</b>
          <small>seuil paume</small>
        </span>
        <span className="stat">
          <b>{snap?.eventsPerSec ?? 0}</b>
          <small>événements/s</small>
        </span>
      </div>

      {snap && snap.tracks.length > 0 ? (
        <ul className="tracks">
          {snap.tracks.map((t) => (
            <li key={t.id} className={`track-${t.state}`}>
              <span className="track-id">#{t.id % 1000}</span>
              <span className="track-text">
                <strong>{STATE_LABEL[t.state] ?? t.state}</strong>
                <small>{t.reason}</small>
              </span>
              <span className="track-size">{t.size} px</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">
          Aucun contact en ce moment. Ouvre un cahier et écris : chaque contact apparaît ici avec la raison de la décision.
        </p>
      )}

      {snap && snap.decisions.length > 0 && (
        <>
          <span className="field-label">Dernières décisions</span>
          <ol className="journal">
            {snap.decisions
              .slice()
              .reverse()
              .map((d, i) => (
                <li key={`${i}-${d}`}>{d}</li>
              ))}
          </ol>
        </>
      )}

      <details className="raw">
        <summary>Détails bruts</summary>
        <dl>
          <dt>Contact</dt>
          <dd>
            {Math.round(snap?.size ?? 0)} px <span className="muted">(max vu {snap?.maxSize ?? 0})</span>
          </dd>
          <dt>Type</dt>
          <dd>{snap?.type === 'pen' ? 'stylet actif' : snap?.type === 'touch' ? 'tactile' : (snap?.type ?? '—')}</dd>
          <dt>Pression</dt>
          <dd>{(snap?.pressure ?? 0).toFixed(2)}</dd>
          <dt>Annulations</dt>
          <dd>{snap?.cancels ?? 0} par Android</dd>
          <dt>Rendu</dt>
          <dd>{snap?.lowLatency ? 'latence réduite' : 'standard'}</dd>
        </dl>
      </details>
    </section>
  );
}
