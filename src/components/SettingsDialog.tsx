import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { FREE_MODELS } from '../ai/gemini';
import { createBackup, restoreBackup } from '../db/backup';
import { downloadBlob } from '../export/download';
import { isNativeApp } from '../platform';
import type { InkStats } from '../ink/InkCanvas';
import { liveStats } from '../ink/liveStats';
import type { SizeMode, TrackInfo } from '../ink/palm';
import type { Handedness, StylusMode } from '../ink/types';
import type { Settings } from '../settings';
import { canUseDrive } from '../sync/drive';
import { syncController, useSyncState } from '../sync/useSync';
import { ICONS } from './Toolbar';
import { Modal } from './Modal';

const STATE_LABEL: Record<string, string> = { pending: 'En attente', draw: 'Écrit', palm: 'Ignoré', gesture: 'Geste' };
const STYLUS_MODES: { value: StylusMode; label: string; hint: string }[] = [
  { value: 'finger', label: 'Standard (recommandé)', hint: 'Le rejet de paume est géré par le système d’exploitation de ta tablette. Tous les contacts sont acceptés de la même façon.' },
  { value: 'active', label: 'S Pen / stylet actif', hint: 'Seul un stylet actif (EMR/USI) peut écrire ; les doigts défilent la page uniquement.' },
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
function AntiPalmSection({ settings, update }: { settings: Settings; update(patch: Partial<Settings>): void }) {
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

function DriveSection({ settings, update }: { settings: Settings; update(patch: Partial<Settings>): void }) {
  const sync = useSyncState();
  const available = canUseDrive();
  const connected = sync.status !== 'disabled' && sync.status !== 'needs-login';
  const origin = window.location.origin;

  return (
    <section>
      <h3>Sauvegarde Google Drive (gratuite)</h3>
      <p className="hint">
        Tout est d’abord enregistré sur l’appareil et marche hors-ligne. Avec Drive, tes dossiers, cahiers, PDF et transcriptions sont
        copiés dans un dossier « Notes Maths (synchronisation) » dès que tu as du réseau, et se retrouvent sur ton PC.
      </p>
      {!available.ok && <p className="lib-error">{available.reason}</p>}
      <label className="field">
        <span>ID client OAuth Google</span>
        <input
          value={settings.driveClientId}
          onChange={(e) => update({ driveClientId: e.target.value.trim() })}
          placeholder="123456789-xxxx.apps.googleusercontent.com"
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <details className="syntax-help">
        <summary>Comment obtenir l’ID client (5 minutes, gratuit)</summary>
        <ol>
          <li>
            Ouvre{' '}
            <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">
              console.cloud.google.com
            </a>{' '}
            et crée un projet.
          </li>
          <li>« API et services » → « Bibliothèque » → active <strong>Google Drive API</strong>.</li>
          <li>« Écran de consentement OAuth » : type Externe, ajoute ton adresse Gmail comme utilisateur test.</li>
          <li>
            « Identifiants » → « Créer des identifiants » → « ID client OAuth » → <strong>Application Web</strong>, avec comme origine
            JavaScript autorisée : <code>{origin}</code>
          </li>
          <li>Copie l’ID client ici, puis « Se connecter ».</li>
        </ol>
      </details>
      <div className="row">
        {connected ? (
          <>
            <button className="primary" onClick={() => void syncController.syncNow()} disabled={sync.status === 'syncing'}>
              Synchroniser maintenant
            </button>
            <button onClick={() => syncController.disconnect()}>Se déconnecter</button>
          </>
        ) : (
          <button className="primary" disabled={!settings.driveClientId || !available.ok} onClick={() => void syncController.connect()}>
            Se connecter à Google Drive
          </button>
        )}
      </div>
      <p className="hint">
        {sync.status === 'syncing' && sync.progress}
        {sync.lastSyncAt && sync.status !== 'syncing' && `Dernière synchronisation : ${new Date(sync.lastSyncAt).toLocaleString('fr-FR')}`}
        {sync.lastReport && sync.status === 'idle' && ` (${sync.lastReport.pulled} reçus, ${sync.lastReport.pushed} envoyés)`}
      </p>
      {sync.error && <p className="lib-error">{sync.error}</p>}
      <label className="check">
        <input type="checkbox" checked={settings.driveAutoSync} onChange={(e) => update({ driveAutoSync: e.target.checked })} />
        Synchroniser automatiquement (après chaque modification et toutes les 5 minutes)
      </label>
    </section>
  );
}

function BackupSection() {
  const [status, setStatus] = useState<{ message: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const run = async (task: () => Promise<string>) => {
    setBusy(true);
    setStatus(null);
    try {
      setStatus({ message: await task(), error: false });
    } catch (e) {
      setStatus({ message: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <h3>Sauvegarde sur fichier</h3>
      <p className="hint">
        Sans compte Google : un fichier avec tous tes dossiers, cahiers, PDF, transcriptions et ton écriture. Restaurer fusionne
        (la version la plus récente de chaque élément gagne).
        {isNativeApp() && ' Dans l’application Android, la sauvegarde s’ouvre dans la feuille de partage : enregistre-la dans Drive, envoie-la par mail…'}
      </p>
      <div className="row">
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const blob = await createBackup();
              await downloadBlob(blob, `notes-maths-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`);
              return `Sauvegarde créée (${(blob.size / 1024 / 1024).toFixed(1)} Mo).`;
            })
          }
        >
          Télécharger une sauvegarde
        </button>
        <button disabled={busy} onClick={() => input.current?.click()}>
          Restaurer une sauvegarde…
        </button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void run(async () => `Restauration terminée : ${(await restoreBackup(file)).imported} élément(s) importé(s).`);
          }}
        />
      </div>
      {busy && (
        <p className="loading">
          <span className="spinner" /> En cours…
        </p>
      )}
      {status && <p className={status.error ? 'lib-error' : 'hint'}>{status.message}</p>}
    </section>
  );
}

export function SettingsDialog({
  settings,
  update,
  onClose,
  onShowWelcome,
}: {
  settings: Settings;
  update(patch: Partial<Settings>): void;
  onClose(): void;
  onShowWelcome(): void;
}) {
  const [showKey, setShowKey] = useState(false);
  const customModel = !FREE_MODELS.includes(settings.model);

  return (
    <Modal title="Réglages" onClose={onClose}>
      <section>
        <h3>Gemini (gratuit)</h3>
        <label className="field">
          <span>Clé API</span>
          <div className="row">
            <input
              type={showKey ? 'text' : 'password'}
              value={settings.apiKey}
              onChange={(e) => update({ apiKey: e.target.value.trim() })}
              placeholder="AIza…"
              autoComplete="off"
              spellCheck={false}
            />
            <button onClick={() => setShowKey((v) => !v)}>{showKey ? 'Masquer' : 'Afficher'}</button>
          </div>
          <small>
            Crée une clé gratuite sur{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              aistudio.google.com/apikey
            </a>
            . Elle reste sur cet appareil (elle n’est pas synchronisée).
          </small>
        </label>
        <label className="field">
          <span>Modèle</span>
          <select value={customModel ? '__custom' : settings.model} onChange={(e) => update({ model: e.target.value === '__custom' ? '' : e.target.value })}>
            {FREE_MODELS.map((m) => (
              <option key={m} value={m}>
                {m === 'gemini-3.8-flash'
                  ? 'Gemini 3.8 Flash'
                  : m === 'gemini-3.8'
                  ? 'Gemini 3.8'
                  : m === 'gemini-2.5-flash'
                  ? 'Gemini 2.5 Flash'
                  : m === 'gemini-2.0-flash'
                  ? 'Gemini 2.0 Flash'
                  : m}
              </option>
            ))}
            <option value="__custom">Autre…</option>
          </select>
          {customModel && <input value={settings.model} onChange={(e) => update({ model: e.target.value.trim() })} placeholder="nom du modèle" />}
          <small>Chaque modèle a son propre quota gratuit.</small>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.autoFallback} onChange={(e) => update({ autoFallback: e.target.checked })} />
          Si Gemini est surchargé (erreur 503) ou le quota atteint, essayer automatiquement un autre modèle
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.convertBackground} onChange={(e) => update({ convertBackground: e.target.checked })} />
          Lire aussi le PDF ou la photo de fond des pages (texte imprimé, tableau), pas seulement ton écriture
        </label>
        <label className="field">
          <span>Contexte par défaut (si le cahier n’a pas de matière)</span>
          <input value={settings.subject} onChange={(e) => update({ subject: e.target.value })} placeholder="ex. Cours de maths, école d’ingénieurs" />
        </label>
      </section>

      <DriveSection settings={settings} update={update} />
      <BackupSection />

      <AntiPalmSection settings={settings} update={update} />

      <section>
        <h3>Aide</h3>
        <button onClick={onShowWelcome}>Revoir le guide de démarrage</button>
      </section>
    </Modal>
  );
}
