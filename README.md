# Notes Maths

Appli de prise de notes pour tablette (Galaxy Tab S6 + stylet) : tu écris tes cours de maths à la main,
Gemini les convertit en LaTeX lisible, et tu exportes en PDF (tel quel, propre, ou « manuscrit lisible »).
100 % gratuit, fonctionne hors-ligne, sauvegarde optionnelle sur Google Drive.

## Fonctionnalités

- **Bibliothèque** : dossiers imbriqués (semestre → matière), cahiers, favoris, récents, corbeille, recherche
  (titres et contenu des transcriptions, sans tenir compte des accents).
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
npm test            # tests : anti-paume, format des transcriptions, fusion de la synchronisation
npm run build       # version de production dans dist/
npm run android:sync  # build + copie dans le projet Android (voir « Application Android »)
```

Ajoute `?demo` à l'adresse pour tester la conversion sans clé (réponses fictives).

## Clé Gemini (gratuite)

1. Va sur [aistudio.google.com/apikey](https://aistudio.google.com/apikey) et crée une clé.
2. Dans l'appli : Réglages → Gemini → colle la clé. Elle reste sur l'appareil.

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

GitHub, lui, ne publie rien : `.github/workflows/ci.yml` lance les tests et la compilation à chaque envoi (une coche
verte ou rouge sur le commit).

**Chaque adresse a ses propres notes** : le site Vercel, l'application Android et tout autre site ne partagent pas
leur stockage. Pour passer des notes de l'un à l'autre, fais une sauvegarde sur fichier (Réglages → Sauvegarde sur
fichier), puis « Restaurer » de l'autre côté.

## Application Android (.apk, 100 % hors-ligne)

L'appli est empaquetée avec **Capacitor** : l'APK embarque directement les fichiers compilés (`dist/`), donc
tout marche sans réseau (le réseau ne sert qu'à la conversion Gemini). Le projet Android est dans `android/`.

### Générer l'APK

Trois façons, de la plus simple à la plus légère. Dans les trois cas, l'APK obtenu s'appelle `app-debug.apk`
(signé avec la clé de debug d'Android : parfait pour ta tablette, à ne pas publier sur le Play Store).

**A. Android Studio (gratuit).** Il apporte tout ce qu'il faut (JDK 21 et SDK Android).

1. Installe [Android Studio](https://developer.android.com/studio) et lance-le une fois pour qu'il télécharge le SDK.
2. Dans ce dossier : `npm install`, puis `npm run android:sync` (compile l'appli et copie `dist/` dans `android/`).
3. `npm run android:open` ouvre le projet dans Android Studio. Attends la fin de « Gradle sync » (la première fois : plusieurs minutes, ça télécharge).
4. Menu **Build → Generate App Bundles or APKs → Generate APKs** (ou **Build APK(s)**).
5. L'APK est dans `android/app/build/outputs/apk/debug/app-debug.apk`.

**B. Ligne de commande** (si le JDK 21 et le SDK Android sont installés, avec `ANDROID_HOME` défini) :

```bash
npm run android:sync
cd android
gradlew assembleDebug        # Windows  (./gradlew assembleDebug sous Linux/macOS)
```

**C. Sans rien installer, sur GitHub.** Une fois le dépôt sur GitHub (voir plus haut) : onglet **Actions** →
**APK Android (debug)** → **Run workflow**. Au bout de quelques minutes, l'APK est à télécharger en bas de la
page de l'exécution, dans **Artifacts**. (Workflow : `.github/workflows/android-apk.yml`.)

### Installer sur la tablette

Copie `app-debug.apk` sur la tablette (câble USB, Drive, mail…) et ouvre-le. Android demandera d'autoriser
« l'installation d'applications inconnues » pour l'application qui l'ouvre (Fichiers, Chrome…). Avec un câble et le
débogage USB : `adb install -r app-debug.apk`. Pour **mettre à jour**, réinstalle par-dessus (les notes sont conservées) :
après un changement de code, refais `npm run android:sync`, augmente `versionCode` dans `android/app/build.gradle`,
puis recompile.

### À savoir

- **Tes notes sont dans l'appli** (stockage de la WebView). Désinstaller l'appli ou « Effacer les données » les
  supprime : fais une sauvegarde `.json` (Réglages → Sauvegarde sur fichier) avant, puis « Restaurer » après.
- **Ne change plus** `appId` (`com.notesmaths.app`) ni `server.androidScheme` dans `capacitor.config.ts` une fois
  l'appli installée : Android verrait une autre appli, vide.
- **Exports** : dans l'APK, un fichier généré (PDF, .tex, sauvegarde) s'ouvre dans la **feuille de partage** d'Android :
  enregistre-le dans Drive ou les fichiers, envoie-le par mail, ouvre-le dans un lecteur PDF…
- **Pas dans l'APK** : « Ouvrir et enregistrer en PDF » (PDF propre LaTeX : la WebView n'a pas de fenêtre
  d'impression — prends le fichier .tex ou le PDF de tes notes en Mode impression) et la synchronisation
  Google Drive (Google refuse la connexion depuis une WebView — utilise la sauvegarde sur fichier).
- **Site web (GitHub Pages)** : rien ne change, `deploy.yml` fixe toujours `BASE_PATH`. Sans `BASE_PATH`, le build utilise des chemins relatifs.
- Il faut une **WebView à jour** (Android System WebView, mise à jour par le Play Store), comme pour Chrome.

## Sauvegarde Google Drive (gratuite)

1. [console.cloud.google.com](https://console.cloud.google.com/) → crée un projet.
2. API et services → Bibliothèque → active **Google Drive API**.
3. Écran de consentement OAuth → Externe → ajoute ton adresse Gmail comme utilisateur test.
4. Identifiants → Créer → **ID client OAuth** → Application Web → origines JavaScript autorisées :
   `https://<ton-pseudo>.github.io` (et `http://localhost:5173` pour le PC).
5. Dans l'appli : Réglages → Sauvegarde Google Drive → colle l'ID client → **Se connecter**.

L'appli n'a accès qu'aux fichiers qu'elle crée (portée `drive.file`), rangés dans le dossier
« Notes Maths (synchronisation) » de ton Drive. Si deux appareils modifient la même page, la version la plus
récente gagne.

## Organisation du code

| Dossier | Rôle |
|---|---|
| `src/ink/` | Écriture : rendu du trait et des formes (`draw.ts`), anti-paume (`palm.ts`), reconnaissance des formes, géométrie (gomme de précision, lasso, mise à l'échelle et rotation : `geometry.ts`), zone de dessin (`InkCanvas.tsx`) |
| `src/db/` | Stockage local IndexedDB et opérations de bibliothèque |
| `src/ai/` | Gemini : prompt, appel avec réessais, format des transcriptions |
| `src/render/` | Affichage KaTeX, tableaux tkz-tab, export LaTeX |
| `src/export/` | PDF vectoriel, PDF manuscrit |
| `src/pdf/` | Lecture des PDF importés (pdf.js) |
| `src/sync/` | Google Drive : connexion, fusion, déclencheurs |
| `src/components/` | Écrans : bibliothèque, éditeur, barre d'onglets, exports, mon écriture, réglages |
| `android/` | Projet Android (Capacitor) : embarque `dist/` dans l'APK ; icônes et écran de démarrage de l'appli |
| `capacitor.config.ts` | Réglages Capacitor (identifiant de l'appli, dossier embarqué `dist`) |
| `src/platform.ts` | `isNativeApp()` : dans l'APK ou dans un navigateur (exports par partage, Drive et impression) |
| `tests/` | Tests exécutés directement par Node (`npm test`) |
