import { useState } from 'react';
import { FREE_MODELS } from '../../ai/gemini';
import type { Settings } from '../../settings';
import { Carte, Interrupteur, Ligne, bouton, champ, discret } from './ui';

const IconeIA = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" />
  </svg>
);

/** « gemini-2.5-flash-lite » → « Gemini 2.5 Flash Lite » */
const nomModele = (m: string) => m.split('-').map((mot) => mot.charAt(0).toUpperCase() + mot.slice(1)).join(' ');

/** Conversion en LaTeX : la clé Gemini gratuite, le modèle, et deux options utiles. */
export function AiSection({ settings, update }: { settings: Settings; update(patch: Partial<Settings>): void }) {
  const [voirCle, setVoirCle] = useState(false);
  const autre = !FREE_MODELS.includes(settings.model);

  return (
    <Carte icone={IconeIA} titre="Intelligence artificielle" sousTitre="Conversion de ton écriture en LaTeX (Gemini, gratuit)">
      <div className="flex flex-col gap-1.5 py-2.5">
        <span className={`text-[12.5px] font-medium ${discret}`}>Clé API Gemini</span>
        <div className="flex gap-2">
          <input
            className={champ}
            type={voirCle ? 'text' : 'password'}
            value={settings.apiKey}
            onChange={(e) => update({ apiKey: e.target.value.trim() })}
            placeholder="AIza…"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className={bouton} onClick={() => setVoirCle((v) => !v)}>
            {voirCle ? 'Masquer' : 'Afficher'}
          </button>
        </div>
        <span className={`text-[12.5px] ${discret}`}>
          Gratuite sur{' '}
          <a className="text-accent" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            aistudio.google.com/apikey
          </a>
          . Elle reste sur cet appareil.
        </span>
      </div>

      <Ligne libelle="Modèle">
        <select
          className={`${champ} w-auto pr-8`}
          value={autre ? '__autre' : settings.model}
          onChange={(e) => update({ model: e.target.value === '__autre' ? '' : e.target.value })}
        >
          {FREE_MODELS.map((m) => (
            <option key={m} value={m}>
              {nomModele(m)}
            </option>
          ))}
          <option value="__autre">Autre…</option>
        </select>
      </Ligne>
      {autre && (
        <input className={`${champ} mb-2`} value={settings.model} onChange={(e) => update({ model: e.target.value.trim() })} placeholder="nom du modèle" />
      )}

      <Ligne libelle="Changer de modèle si Gemini sature" precision="Surcharge ou quota atteint : un autre modèle gratuit prend le relais.">
        <Interrupteur actif={settings.autoFallback} onChange={(v) => update({ autoFallback: v })} libelle="Changer de modèle si Gemini sature" />
      </Ligne>
      <Ligne libelle="Lire aussi le fond des pages" precision="Le PDF ou la photo sous tes notes, pas seulement ton écriture.">
        <Interrupteur actif={settings.convertBackground} onChange={(v) => update({ convertBackground: v })} libelle="Lire aussi le fond des pages" />
      </Ligne>

      <label className="flex flex-col gap-1.5 border-t border-[color:var(--line)] pt-2.5">
        <span className={`text-[12.5px] font-medium ${discret}`}>Matière par défaut (quand le cahier n’en a pas)</span>
        <input className={champ} value={settings.subject} onChange={(e) => update({ subject: e.target.value })} placeholder="ex. Cours de maths, école d’ingénieurs" />
      </label>
    </Carte>
  );
}
