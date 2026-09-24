import type { Settings } from '../../settings';
import { Carte, Interrupteur, Ligne, Segmente } from './ui';

const IconeStylo = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3" />
  </svg>
);

/**
 * L'essentiel pour écrire, rien de plus. Les réglages fins de l'anti-paume (calibrage, taille des contacts,
 * zone de repos, diagnostic) ont quitté l'interface : leurs valeurs déjà enregistrées restent appliquées,
 * pour que l'écriture se comporte exactement comme avant.
 */
export function WritingSection({ settings, update }: { settings: Settings; update(patch: Partial<Settings>): void }) {
  const strict = settings.stylusMode === 'active';
  return (
    <Carte icone={IconeStylo} titre="Écriture">
      <Ligne libelle="Main d’écriture" precision="La barre des pages se place du côté opposé.">
        <Segmente
          libelle="Main d’écriture"
          valeur={settings.handedness}
          options={[
            { valeur: 'right', libelle: 'Droite' },
            { valeur: 'left', libelle: 'Gauche' },
          ]}
          onChange={(handedness) => update({ handedness })}
        />
      </Ligne>
      <Ligne
        libelle="Stylet actif strict"
        precision={strict ? 'Seul le stylet écrit ; les doigts déplacent et zooment.' : 'Tout contact écrit (doigt, stylet passif, souris).'}
      >
        <Interrupteur actif={strict} onChange={(v) => update({ stylusMode: v ? 'active' : 'finger' })} libelle="Stylet actif strict" />
      </Ligne>
    </Carte>
  );
}
