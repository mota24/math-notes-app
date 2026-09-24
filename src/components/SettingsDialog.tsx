import { useState } from 'react';
import { FREE_MODELS } from '../ai/gemini';
import type { Settings } from '../settings';
import { Modal } from './Modal';
import { AntiPalmSection } from './settings/AntiPalmSection';
import { BackupSection } from './settings/BackupSection';
import { DriveSection } from './settings/DriveSection';
import { FirestoreSection } from './settings/FirestoreSection';

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
            . Elle reste sur cet appareil (elle n’est pas synchronisée). Conseil : dans Google Cloud, restreins la clé à
            l’adresse du site (« Référents HTTP ») et à l’API Generative Language, pour qu’elle ne serve à rien ailleurs
            (voir le README).
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
      <FirestoreSection settings={settings} update={update} />
      <BackupSection settings={settings} />

      <AntiPalmSection settings={settings} update={update} />

      <section>
        <h3>Aide</h3>
        <button onClick={onShowWelcome}>Revoir le guide de démarrage</button>
      </section>
    </Modal>
  );
}
