# Notes Maths

Appli de prise de notes pour tablette (Galaxy Tab S6 + stylet) : tu écris tes cours de maths à la main,
Gemini les convertit en LaTeX lisible, et tu exportes en PDF (tel quel, propre, ou « manuscrit lisible »).
100 % gratuit, fonctionne hors-ligne, sauvegarde optionnelle sur Google Drive.

## Fonctionnalités

- **Bibliothèque** : dossiers imbriqués (semestre → matière), cahiers, favoris, récents, corbeille, recherche
  (titres et contenu des transcriptions, sans tenir compte des accents).
  - **Une barre latérale** (250 px, un peu plus sombre que la page) : le nom de l'appli, la recherche, *Bibliothèque*, l'arbre de *Mes dossiers* (les dossiers imbriqués se déplient, celui qu'on ouvre l'est d'office, un « + » en crée un), *Corbeille* (avec son compteur), puis *Mon écriture*, *Réglages* et l'état de la synchronisation Drive. Elle reste affichée dès 1024 px de large (tablette en paysage) ; en dessous (portrait, téléphone), c'est un tiroir qu'ouvre le bouton ☰ du haut, avec un voile flou.
  - **Un grand titre qui suit ce qu'on regarde** — *Récents* à l'accueil, le nom du dossier ouvert (avec son chemin cliquable au-dessus), *Corbeille*, *Résultats* pour une recherche — et, en haut à droite, les actions principales en verre dépoli : **+ Cahier** (teinté d'accent), **+ Dossier**, **Importer un PDF** (leurs libellés se réduisent à un pictogramme sur un écran étroit).
  - **Des cartes en verre** : fond translucide et flou, contour fin, ombre douce, et la couleur du cahier ou du dossier en discret (une fine ligne en haut, une lueur dans un coin). Chaque cahier montre son **papier en miniature** (carreaux, Seyès, lignes ou blanc, clair ou sombre), son titre, sa matière, ses pages et sa date, avec l'étoile des favoris et un menu « ⋯ » (couleur, renommer, déplacer, corbeille). Au survol, la carte grossit un peu ; sur une tablette tactile, rien ne dépend du survol.
  - **Une grille qui suit la place disponible** (et non la largeur de l'écran, dont la barre latérale prend une part) : 2, 3, 4, 5 puis 6 colonnes ; les *Récents* tiennent sur une seule rangée, sans case vide, et une case pointillée « Nouveau cahier » termine la grille des cahiers.
- **Cahiers** : pages petits carreaux, Seyès, lignées ou blanches ; **import de PDF** (TD, slides) à annoter ;
  **photos** (tableau, livre) en pages annotables ; ajout, suppression, réorganisation des pages ; vignettes.
- **Onglets de cahiers** (façon navigateur) : plusieurs cahiers restent ouverts en haut de l'écran, on passe de l'un à l'autre d'un tap sans repasser par la bibliothèque ; chaque onglet retient sa page, et la liste est gardée d'une session à l'autre.
- **Pagination en marge** : page précédente / suivante, liste des pages et « ajouter une page » sont dans une colonne verticale sur le fond gris, **du côté opposé à la main qui écrit** (réglable dans Réglages → « Main d'écriture ») — jamais sur la feuille.
- **Écriture** : stylo (couleurs + couleur libre), **surligneur**, gomme, main ;
  **épaisseur au curseur, de 1 à 20 px** (4 à 40 px pour le surligneur) ; **traits pointillés** (option « Style du trait » du stylo et des formes : arêtes cachées, lignes de projection…) ;
  **appui long** (stylet posé sans bouger) = gomme temporaire, quel que soit l'outil (même « Formes & tampons »), jusqu'à ce que tu lèves le stylet ;
  **deux doigts** : défilement et zoom (pincement), même si les doigts se posent l'un après l'autre ;
  tap à deux doigts = annuler.
- **Couleurs rapides** dans la barre d'outils : trois pastilles qui suivent l'outil actif — noir, blanc et rouge pour le stylo, les formes et la ligne ; jaune, vert et noir pour le surligneur — et un tap sur l'une applique la couleur tout de suite. La **roue multicolore** à côté ouvre le popover habituel : toutes les autres couleurs (dont une couleur libre) et l'épaisseur du trait. La barre reste **sur une seule ligne, sans jamais défiler** : elle se resserre toute seule si la zone d'écriture est étroite (tablette en portrait, panneau des pages ouvert).
- **Couleur automatique des formes et des lignes** : elles ont leur propre couleur (l'épaisseur, elle, reste celle du stylo), **noire sur papier clair et blanche sur papier sombre** tant que tu n'en as pas choisi une — plus de figure blanche invisible sur une page blanche. Le bouton **Auto** du popover des formes y revient.
- **Barre en verre dépoli** : la pilule d'outils est translucide (flou de 12 px, ombre douce), plus sombre sur un papier sombre ; **l'outil actif est agrandi, coloré et cerclé d'un halo**, et les boutons changent d'état en douceur. **Sécurité tactile** : pas de rebond de défilement, pas de sélection de texte, de menu contextuel ni de surbrillance sur l'interface (les champs de saisie et les textes à copier restent sélectionnables), et le stylet ne fait jamais défiler la page du navigateur.
- **Gomme à deux modes** (popover de l'outil Gomme, taille réglable) : **par trait** (efface d'un coup tout le trait ou toute la forme touchés) ou **de précision** (n'enlève que la zone exacte où passe la gomme : un trait à main levée, un cercle, un rectangle, un triangle, une ligne ou une flèche sont découpés ; repères, torseur, matrice et volumes partent en entier). Comme pour le stylo, **un premier tap choisit la gomme** (dans le dernier mode utilisé) et **un second tap ouvre ses réglages**. **Les images ne sont jamais effacées par la gomme** (on écrit souvent par-dessus) : pour en retirer une, lasso puis « Supprimer ».
- **Lasso intelligent** : dès que la ligne du lasso touche, croise ou entoure un élément — même d'un tout petit bout — il est sélectionné (les formes creuses comptent pour leur contour : un lasso tracé à l'intérieur d'un cadre, autour de son texte, ne prend pas le cadre). Déplacer, dupliquer, copier/coller (même vers un autre cahier), convertir la zone, ou **recolorer** : la barre de sélection propose trois couleurs et une **pastille multicolore** ; une teinte choisie avec elle passe en premier et décale les autres (violet → prend la place du noir, le noir celle du bleu…), la palette est retenue d'une session à l'autre.
- **Redimensionner et faire pivoter une sélection** : le lasso (ou une forme qu'on vient de poser) reçoit un **cadre en pointillés** et des poignées rondes, larges, pensées pour un stylet capacitif : **4 poignées d'angle** mettent à l'échelle **sans déformer** (le coin opposé reste fixe), et une **poignée de rotation** (sous le cadre, ou au-dessus s'il n'y a pas de place) fait pivoter autour du centre, avec un angle affiché et une **aimantation tous les 15°** (une ligne se remet droite sans viser). Ça vaut pour l'écriture, les formes et les images, seules ou mélangées ; une **forme droite** se déforme aussi par les milieux de ses bords, une **ligne ou une flèche** par ses deux bouts. Rien ne sort de la page (et le papier s'allonge vers le bas si besoin), chaque geste est **un seul pas d'annulation**, et les coordonnées enregistrées sont réécrites pour de bon : sauvegarde, PDF et conversion voient la même chose.
- **Lasso de capture** : encadre une zone (poignées pour l'ajuster), « Copier » en fait une image transparente, « Coller » la pose sur la page comme un objet redimensionnable.
- **Anti-paume « le mouvement d'abord »** pour stylet capacitif (vu comme un doigt, ici 203 px de contact) :
  le contact qui se déplace franchement écrit, ceux qui restent posés sont ignorés — quels que soient leur
  nombre et leur position (droitier ou gaucher, peu importe). Un « trait » laissé par une paume qui glisse en
  se posant est effacé dès que le stylet écrit.
- **Filtre de taille** : un contact nettement plus gros que ton stylet n'écrit jamais. La taille du stylet est
  apprise sur tes traits **et retenue d'une session à l'autre** ; la section « Anti-paume » des Réglages permet aussi de
  **calibrer** (pose le stylet, pose la paume, le seuil se règle entre les deux) et montre, pour chaque contact,
  la décision prise et le journal des dernières décisions. Tout se règle dans **Réglages → Anti-paume**, pour que la barre d'outils flottante ne serve qu'à dessiner.
- **Conversion en LaTeX** (Gemini, niveau gratuit) : zone au lasso, page, ou cahier entier ; lit aussi le **texte
  imprimé** des PDF et des photos ; tableaux de signes et de variations (tkz-tab) ; passages douteux surlignés ;
  transcription **modifiable** avec aperçu ; texte **collé depuis ChatGPT** (`\( \)`, `\[ \]`, titres, listes) ;
  nouvel essai automatique et changement de modèle quand Gemini est surchargé.
- **Exports** : PDF de tes notes (vectoriel, avec le PDF ou la photo d'origine ; case **Mode impression** : fond blanc à réglures pâles, encre claire — blanc, pastels — convertie en noir ou en teinte foncée, pour lire et économiser l'encre ; les surligneurs gardent leur couleur) ; PDF propre via l'impression ;
  fichier `.tex` pour Overleaf ; **PDF manuscrit lisible** (police manuscrite ou **ta propre écriture**, taille,
  variations, papier, encre) — l'équivalent de MatHandWrite, y compris à partir d'un PDF de cours.
- **Glisser une formule sur la page** : depuis une conversion (sélection ou page entière), « Poser sur la page » rend le résultat en image nette (police mathématique normale, pas manuscrite) et la pose sur la feuille — déplaçable, duplicable, effaçable comme un trait, incluse dans les PDF.
- **Formes & tampons** (outil dédié dans la barre, à côté du lasso) :
  - **Dessiner → maintenir → ajuster** : trace un cercle, un rectangle, un triangle, une ligne ou une flèche au stylo normal, reste appuyé sans lever la pointe en fin de trait (~0,3 s, réglable dans Réglages → Anti-paume) — le trait brouillon devient une figure parfaite (un trait droit reste un trait : c'est une flèche seulement si tu as dessiné une pointe), encore **étirable en glissant la pointe** tant qu'elle n'est pas levée. Un bref flash bleu confirme la transformation. Ne se déclenche jamais pendant un tracé actif ni en même temps que l'appui long « gomme » (zone morte entre les deux).
  - **Retour automatique au stylo** : dès qu'un tampon est posé (tap ou glissé), l'outil repasse **au stylo** — on ne dessine plus une forme par mégarde en reprenant l'écriture ; la figure reste sélectionnée avec ses poignées, pour l'ajuster tout de suite.
  - **Tampons d'ingénierie** (sous-menu du même outil) : cercle, rectangle, triangle, flèche, **ligne droite** (de A à B, ou horizontale d'un simple tap), repère 2D, repère 3D en perspective cavalière (z vertical, y horizontal, x en diagonale, sans lettres), torseur (accolade), matrice `( )` dessinées comme de vraies accolades avec un large espace pour écrire — un tap les pose à une taille par défaut, un glissé choisit la taille.
  - **Volumes 3D** avec arêtes cachées en tirets : cylindre, cône, sphère, demi-sphère, pyramide, pavé droit (parallélépipède rectangle), **tore**, **prisme triangulaire**, **tétraèdre** et **ellipsoïde**. Le prisme et le tétraèdre sont en perspective cavalière ; pour le tore et l'ellipsoïde, un vrai test de visibilité décide de ce qui passe derrière le volume (contour, équateur, méridien).
  - Formes et tampons sont des objets comme les images glissées : déplaçables, dupliquables, effaçables, recolorables, inclus dans la conversion Gemini et dans le PDF vectoriel (tirets compris, net à tout zoom, même tournés).
- **Marge de la page** : toucher/glisser en dehors de la feuille déplace la vue (comme sur GoodNotes) ; l'encre ne peut jamais sortir des bords de la page sur les côtés et en haut.
- **Canevas infini vers le bas** : sur une page d'écriture (pas sur un PDF ou une photo importés), on peut **défiler sans limite** — deux doigts, molette, ou en glissant dans la marge — et le papier se déroule par **feuilles A4 entières**, tout seul, quand on approche du bas ou qu'on écrit près du bord. Un trait pointillé « Feuille 2 », « Feuille 3 »… marque où la page se coupe à l'impression. La hauteur enregistrée ne suit que ce qui est écrit (défiler ne crée pas de feuilles vides gardées) et redescend si on efface le bas. Jusqu'à 30 feuilles (~9 m). L'**export PDF** (avec ou sans Mode impression) coupe une longue page en pages A4, réglures comprises ; la vignette montre la première feuille avec le nombre de feuilles.
- **Papier sombre** (par défaut pour les nouveaux cahiers) : fond noir avec quadrillage adapté, pour écrire en encre claire (blanc dans la palette) ; l'export « PDF de mes notes » garde ce fond sombre pour que l'encre claire reste lisible (ou passe en Mode impression pour un fond blanc).
- **Hors-ligne** : tout est stocké sur l'appareil (IndexedDB) ; l'appli installée s'ouvre sans réseau.
- **Sauvegardes** : fichier `.json` à télécharger / restaurer (sans compte), ou synchronisation automatique Google Drive.
- **Guide de démarrage** au premier lancement, écran d'erreur qui n'efface rien si un écran plante.

## Lancer l'appli

```bash
npm install
npm run dev         # sur le PC : http://localhost:5173
npm run tablette    # accessible depuis la tablette sur le même Wi-Fi (adresse « Network »)
npm test            # tests : anti-paume, formes, géométrie, bibliothèque, format des transcriptions, fusion de la synchronisation, sauvegardes
npm run lint        # vérification du code (oxlint : TypeScript, React hooks)
npm run build       # version de production dans dist/
```

Ajoute `?demo` à l'adresse pour tester la conversion sans clé (réponses fictives).

## Clé Gemini (gratuite)

1. Va sur [aistudio.google.com/apikey](https://aistudio.google.com/apikey) et crée une clé.
2. Dans l'appli : Réglages → Gemini → colle la clé. Elle reste sur l'appareil (jamais synchronisée, jamais dans les
   sauvegardes).
3. **Restreins la clé** (recommandé) : la clé est utilisée directement depuis le navigateur, donc quelqu'un qui aurait
   accès à ta tablette pourrait la lire. Dans [console.cloud.google.com](https://console.cloud.google.com/apis/credentials)
   → *Identifiants* → ta clé → *Restrictions liées aux applications* : **Référents HTTP**, et ajoute
   `https://math-notes-app-indol.vercel.app/*` (et `http://localhost:5173/*` pour le PC) ; *Restrictions liées aux API* :
   **Generative Language API** seulement. Ainsi la clé ne sert à rien ailleurs que dans l'appli.

## Mettre l'appli en ligne (Vercel, gratuit)

Nécessaire pour **installer** l'appli sur la tablette (écran d'accueil), l'utiliser **hors-ligne** et se connecter à
**Google Drive** (Google exige une adresse `https://`). Le site est publié sur **Vercel** :
<https://math-notes-app-indol.vercel.app/>.

1. Le code est sur GitHub (dépôt `mota24/math-notes-app`, branche `main`).
2. Sur [vercel.com](https://vercel.com) : **Add New → Project**, puis ce dépôt. Vercel reconnaît Vite tout seul
   (commande `npm run build`, dossier `dist`) : il n'y a rien à régler.
3. Ensuite, chaque envoi sur `main` reconstruit et republie le site, en une minute environ.
4. Sur la tablette, ouvre l'adresse dans Chrome → menu ⋮ → **Ajouter à l'écran d'accueil**.
5. Pour Google Drive, ajoute l'adresse du site (`https://math-notes-app-indol.vercel.app`) comme « origine
   JavaScript autorisée » de ton ID client OAuth (voir plus bas).

GitHub, lui, ne publie rien : `.github/workflows/ci.yml` lance les tests, la vérification du code (`npm run lint`) et la
compilation à chaque envoi (une coche verte ou rouge sur le commit).

### Sécurité du site

`vercel.json` fixe les en-têtes HTTP de sécurité : une **Content-Security-Policy** stricte (seuls le site lui-même,
Gemini, Google Drive et la connexion Google sont autorisés ; aucun script tiers, pas d'iframe), `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy` et HSTS. Il règle aussi le cache : `sw.js`, `precache.json` et `index.html`
ne sont jamais mis en cache (une mise à jour est vue tout de suite), les fichiers de `assets/` (nom avec empreinte)
le sont un an. **Si tu ajoutes un service externe** (police, script, API), ajoute son adresse dans la CSP, sinon le
navigateur le bloquera silencieusement (regarde la console du navigateur).

Rappel de ce qui est stocké où : les notes sont dans IndexedDB sur l'appareil ; la clé Gemini et l'ID client OAuth dans
`localStorage` ; le jeton Google Drive (1 h) seulement en mémoire et dans `sessionStorage`, effacé à la fermeture de
l'appli. Aucun serveur à toi : rien ne transite ailleurs que vers Google.

**Chaque adresse a ses propres notes locales** (le site Vercel, `localhost`…) : c'est la synchronisation en temps réel
(Réglages → Cloud & Sauvegarde) qui les réunit sur tous tes appareils. À défaut, une copie de sauvegarde sur fichier
(« Télécharger » puis « Restaurer… ») fait le pont.

### Accès réservé (connexion obligatoire)

Aucun écran de l'appli ne s'affiche sans connexion Firebase, et **un compte connecté ne suffit pas** : il doit être
autorisé (`src/auth/access.ts`).

- **Par défaut**, le premier compte qui se connecte sur un appareil en devient le propriétaire ; tout autre compte (même
  un compte Google valide) y est refusé et déconnecté. Aucune synchronisation ne démarre avant cette vérification.
- **Liste blanche** (recommandé) : dans Vercel, ajoute la variable `VITE_ALLOWED_EMAILS` avec ton adresse (plusieurs
  adresses séparées par des virgules), puis redéploie. Seuls ces comptes peuvent alors entrer, sur tous les appareils.
- **Fermer la création de comptes** : console Firebase → Authentication → Settings → *User actions* → décoche
  « Enable create (sign-up) ». Plus personne ne pourra se créer de compte, ni par e-mail ni par Google.

Ce verrou protège l'écran, pas le disque : les notes restent lisibles dans le stockage du navigateur par qui a
l'appareil et les outils de développement.

### Règles Firestore

Les règles de sécurité sont dans `firestore.rules` : chaque compte ne lit et n'écrit que `users/<son uid>/…`, avec la
forme exacte des documents de l'appli ; tout le reste est fermé. **Elles ne s'appliquent qu'une fois publiées** :
console Firebase → Firestore Database → Règles → coller le fichier → Publier (ou
`npx firebase-tools deploy --only firestore:rules --project math-notes-pwa`).

## Sauvegarde Google Drive (gratuite)

1. [console.cloud.google.com](https://console.cloud.google.com/) → crée un projet.
2. API et services → Bibliothèque → active **Google Drive API**.
3. Écran de consentement OAuth → Externe → ajoute ton adresse Gmail comme utilisateur test.
4. Identifiants → Créer → **ID client OAuth** → Application Web → origines JavaScript autorisées :
   `https://math-notes-app-indol.vercel.app` (et `http://localhost:5173` pour le PC).
5. Dans l'appli : Réglages → Sauvegarde Google Drive → colle l'ID client → **Se connecter**.

L'appli n'a accès qu'aux fichiers qu'elle crée (portée `drive.file`), rangés dans le dossier
« Notes Maths (synchronisation) » de ton Drive. Si deux appareils modifient la même page, la version la plus
récente gagne.

## Organisation du code

| Dossier | Rôle |
|---|---|
| `src/ink/` | Écriture : rendu du trait et des formes (`draw.ts`), anti-paume (`palm.ts`), reconnaissance des formes, géométrie (gomme de précision, lasso, mise à l'échelle et rotation : `geometry.ts`), zone de dessin (`InkCanvas.tsx`) avec ses feuilles (`sheets.ts`), ses poignées (`handles.ts`) et l'historique annuler / rétablir (`history.ts`) |
| `src/db/` | Stockage local IndexedDB et opérations de bibliothèque ; `storageAlert.ts` signale un enregistrement impossible (stockage plein) au lieu de le perdre en silence |
| `src/ai/` | Gemini : prompt, appel avec réessais, format des transcriptions |
| `src/render/` | Affichage KaTeX, tableaux tkz-tab, export LaTeX |
| `src/export/` | PDF vectoriel, PDF manuscrit |
| `src/pdf/` | Lecture des PDF importés (pdf.js) |
| `src/sync/` | Synchronisation : temps réel Firestore (`firestore.ts` : envois groupés, reprises après coupure) et Google Drive ; même fusion « le plus récent gagne » (`merge.ts`) |
| `src/auth/` | Accès réservé : qui a le droit d'entrer (`access.ts`, testé), la porte d'entrée (`useAccess.ts`), la déconnexion complète |
| `src/db/backupFormat.ts` | Format du fichier de sauvegarde et sa validation (rien n'est écrit dans la base avant vérification) |
| `vercel.json` | En-têtes de sécurité (CSP…) et règles de cache du site en ligne |
| `src/components/` | Écrans : bibliothèque (`Library*.tsx`), éditeur, barre d'onglets, exports, mon écriture, réglages (`SettingsDialog.tsx` : trois cartes dans `settings/`, briques communes dans `settings/ui.tsx`), écran de connexion (`AuthPanel.tsx`), indicateur de synchro (`CloudIndicator.tsx`), pictogrammes (`icons.tsx`) et catalogue des tampons (`stamps.tsx`) |
| `src/index.css` | Point d'entrée des styles : Tailwind CSS, KaTeX et l'ancienne feuille `styles.css`, rangés en couches (voir ci-dessous) |
| `tests/` | Tests exécutés directement par Node (`npm test`) : anti-paume, formes, géométrie, feuilles, historique, bibliothèque, réponses du modèle, tableaux tkz-tab, rendu des maths, navigation, sauvegardes, fusion de la synchronisation |

### Les styles : Tailwind CSS et l'ancienne feuille

La bibliothèque est dessinée avec **Tailwind CSS** (v4, gratuit, ajouté à la compilation seulement : rien de plus dans l'appli). Le reste de l'appli garde son ancienne feuille de style, `src/styles.css`, et les écrans passeront à Tailwind un par un. Pour que les deux cohabitent :

- **pas de « Preflight »** (la remise à zéro de Tailwind) : elle changerait tous les écrans existants ; seuls le thème et les utilitaires sont importés (`src/index.css`) ;
- **des couches CSS** fixent qui gagne : `theme` < `vendor` (KaTeX) < `legacy` (`styles.css`) < `utilities` (Tailwind). Une classe Tailwind l'emporte donc toujours sur les règles générales de l'ancienne feuille (`button { padding… }`), sans `!important` ;
- **le thème sombre suit le système** (`dark:`), comme avant : seules la bibliothèque et les boîtes de dialogue s'assombrissent, l'éditeur garde son papier clair ;
- **les recettes partagées** (bouton en verre, panneau de verre…) sont dans `src/components/libraryStyles.ts`, et ce que la bibliothèque calcule (arbre des dossiers, chemin, compteurs, papier en miniature) dans `src/components/libraryModel.ts`, testé sous Node.
