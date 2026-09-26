# Notes Maths

Appli de prise de notes pour tablette (Galaxy Tab S6 + stylet), qui marche aussi sur téléphone, iPad et ordinateur :
tu écris tes cours de maths à la main, tu annotes tes PDF de cours, et tu exportes en PDF. 100 % gratuit, fonctionne
hors-ligne ; la synchronisation Firestore garde une copie de tes cahiers ET de tes PDF dans le cloud.

## Fonctionnalités

- **Bibliothèque** : dossiers imbriqués **sans limite de profondeur** (semestre → matière → chapitre → …), « Nouveau sous-dossier » depuis le menu d'un dossier ou le « + » de chaque ligne de l'arbre, **fil d'Ariane** cliquable en haut (replié au-delà de 4 niveaux), cahiers, favoris, récents, corbeille, recherche. Un sous-dossier dont le parent a disparu (synchronisation croisée) ou un cycle de dossiers revient à la racine au lieu de devenir invisible
  (titres et contenu des transcriptions, sans tenir compte des accents).
  - **Une barre latérale** (250 px, un peu plus sombre que la page) : le nom de l'appli, la recherche, *Bibliothèque*, l'arbre de *Mes dossiers* (les dossiers imbriqués se déplient, celui qu'on ouvre l'est d'office, un « + » en crée un), *Corbeille* (avec son compteur), puis *Mon écriture*, *Réglages* et l'état de la synchronisation Drive. Elle reste affichée dès 1024 px de large (tablette en paysage) ; en dessous (portrait, téléphone), c'est un tiroir qu'ouvre le bouton ☰ du haut, avec un voile flou.
  - **Un grand titre qui suit ce qu'on regarde** — *Récents* à l'accueil, le nom du dossier ouvert (avec son chemin cliquable au-dessus), *Corbeille*, *Résultats* pour une recherche — et, en haut à droite, les actions principales en verre dépoli : **+ Cahier** (teinté d'accent), **+ Dossier**, **Importer un PDF** (leurs libellés se réduisent à un pictogramme sur un écran étroit).
  - **Des cartes sombres** : gris uni, contour fin, ombre douce, et la couleur du cahier ou du dossier en pastille. Chaque cahier montre sa **couverture** : la **première page de son PDF** (ou de sa photo) en miniature — rendue une fois, puis gardée sur l'appareil —, sinon son **papier en miniature** (carreaux, Seyès, lignes), et un **dégradé discret de sa couleur** avec son pictogramme quand il n'y a rien à montrer (papier blanc, PDF pas encore synchronisé). Puis son titre, sa matière, ses pages et sa date, avec l'étoile des favoris et un menu « ⋯ » : la couleur (les 8 pastilles, la **roue chromatique** pour n'importe quelle teinte, ou le **code hexadécimal** exact, ex. `#1e90ff`), renommer, déplacer, corbeille. Au survol, la carte grossit un peu ; sur une tablette tactile, rien ne dépend du survol.
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
- **Conversion par IA (Gemini) : retirée** (septembre 2026). Les transcriptions déjà faites restent dans la base et
  servent encore aux exports LaTeX et manuscrit ; la clé API éventuellement enregistrée est effacée au démarrage.
- **Exports** : PDF de tes notes (vectoriel, avec le PDF ou la photo d'origine ; case **Mode impression** : fond blanc à réglures pâles, encre claire — blanc, pastels — convertie en noir ou en teinte foncée, pour lire et économiser l'encre ; les surligneurs gardent leur couleur) ; PDF propre via l'impression ;
  fichier `.tex` pour Overleaf ; **PDF manuscrit lisible** (police manuscrite ou **ta propre écriture**, taille,
  variations, papier, encre) — l'équivalent de MatHandWrite, y compris à partir d'un PDF de cours.
- **Texte des PDF et des scans** (bouton « Texte » de la barre du haut, ou Ctrl+F) : le texte du fond des pages devient **sélectionnable et copiable** (appui long sur un mot, poignées, « Copier » ; glisser à la souris), et une **recherche plein texte** parcourt tout le cahier (sans accents ni majuscules, à cheval sur plusieurs mots ou lignes) avec surlignage et navigation entre les résultats. Un PDF qui contient déjà du texte est lu tel quel (instantané, exact) ; un **scan** ou une photo est lu par **Tesseract.js** (OCR, français + anglais) dans un Web Worker, sans figer l'interface. Rien n'est chargé au démarrage : le moteur et les langues (~8 Mo, servis par le site, pas de CDN) arrivent à la première lecture, puis restent sur l'appareil (hors-ligne compris), et chaque page lue est gardée pour ne jamais être relue. 100 % gratuit, rien n'est envoyé à un serveur.
- **Corriger le texte d'un scan** : entoure au lasso des mots imprimés d'un PDF scanné ou d'une photo, puis « Corriger le texte ». Le texte de la zone est lu (OCR), son encre est effacée dans une **rustine** — une image posée par-dessus, comme un calque : le scan d'origine n'est jamais modifié, supprimer la rustine le fait réapparaître — et une zone de texte est posée à sa place, **à la hauteur des lettres d'origine et de la couleur de leur encre**, pré-remplie avec le texte lu, prête à corriger. Rustine et texte arrivent en un seul pas d'annulation. L'effacement (remplissage « pull-push » multirésolution, qui prolonge le papier voisin sans flou ni emprunt aux lignes voisines) tourne dans un Web Worker, en quelques dizaines de millisecondes. **Police assortie au document** : le texte de remplacement prend automatiquement la famille (Times, Arial ou Courier — servies par le site sous les noms Tinos, Arimo, Cousine, polices libres aux mêmes dimensions), la graisse, l'inclinaison et la **hauteur exacte** des lettres d'origine, et repose sur la **même ligne de base**. Tesseract ne donnant pas ces informations, elles sont mesurées : hauteur des capitales et des minuscules caractère par caractère, largeur de l'encre des mots comparée à chaque police, épaisseur des traits et contraste plein / délié (dans le Web Worker de l'effacement). Sur un scan d'essai : 5 polices sur 5 reconnues, hauteur à 0,5–1,6 % près, ligne de base à 0,02 mm près. La barre de sélection d'une zone de texte permet d'ajuster : police (appli → Times → Arial → Courier → **« Mon écriture »**), **G** (gras), *I* (italique).
- **Signatures enregistrées** : trace ta signature une fois (Formes & tampons → Signatures → « Ma signature » ; stylet, doigt ou souris, pression du stylet prise en compte, la paume posée est ignorée), jusqu'à trois (signature complète, paraphe…). Un toucher sur l'une la pose en bas à droite de la page, à la couleur du stylo, déjà sélectionnée pour la glisser à sa place ou l'agrandir. Les signatures restent **sur cet appareil uniquement** : jamais synchronisées ni mises dans les sauvegardes (une fois posée sur une page, la signature fait partie de cette page comme n'importe quel contenu).
- **Écran partagé** : deux cahiers côte à côte (le PDF du cours à gauche, tes notes à droite). Le bouton de la barre ouvre d'abord un **mini-explorateur** sombre : récents, dossiers et sous-dossiers à parcourir (fil d'Ariane), ou recherche dans toute la bibliothèque (sans accents ni majuscules, par nom, dossier ou matière). Le titre du volet le rouvre pour changer de cahier. Depuis la bibliothèque, le menu « ⋯ » d'un cahier propose **Ouvrir à côté de « … »** (le dernier cahier ouvert). Zoom, ⇄ pour échanger les côtés, poignée pour la largeur.
- **Zones de texte** (outil « T ») : touche la page — ou un PDF — pour poser une zone (glisse pour choisir sa largeur), puis tape au clavier ; le texte revient à la ligne tout seul. **Un tap sur un texte posé le sélectionne directement** — au stylet, au doigt ou à la souris, avec n'importe quel outil d'écriture — : ses poignées et sa barre (couleurs, **Modifier**, dupliquer, copier, supprimer) apparaissent sans passer par le lasso, et l'outil d'avant revient quand la sélection se referme. Un second tap sur le texte sélectionné (ou « Modifier ») pour écrire dedans ; vidé, il disparaît. Sélectionné : déplacer, agrandir (le texte grossit avec la zone), élargir ou rétrécir par les bords (le texte se réorganise), tourner, recolorer, dupliquer. Trois tailles et les couleurs du stylo ; l'encre passe par-dessus et la gomme ne l'efface jamais. Inclus dans la synchro, le partage et l'export PDF (tous les caractères : θ, ≠, ∫…).
- **Formes & tampons** (outil dédié dans la barre, à côté du lasso) :
  - **Dessiner → maintenir → ajuster** : trace un cercle, un rectangle, un triangle, une ligne ou une flèche au stylo normal, reste appuyé sans lever la pointe en fin de trait (**0,5 s**, au stylet, au doigt ou à la souris) — le trait brouillon devient une figure parfaite : une ellipse presque ronde devient un **cercle**, un rectangle presque carré un **carré**, une ligne presque horizontale, verticale ou à 45° s'aligne exactement (un trait droit reste un trait : c'est une flèche seulement si tu as dessiné une pointe), encore **étirable en glissant la pointe** tant qu'elle n'est pas levée. Un bref flash bleu confirme la transformation. Ne se déclenche jamais pendant un tracé actif ni en même temps que l'appui long « gomme » (zone morte entre les deux).
  - **Retour automatique au stylo** : dès qu'un tampon est posé (tap ou glissé), l'outil repasse **au stylo** — on ne dessine plus une forme par mégarde en reprenant l'écriture ; la figure reste sélectionnée avec ses poignées, pour l'ajuster tout de suite.
  - **Tampons d'ingénierie** (sous-menu du même outil) : cercle, rectangle, triangle, flèche, **ligne droite** (de A à B, ou horizontale d'un simple tap), repère 2D, repère 3D en perspective cavalière (z vertical, y horizontal, x en diagonale, sans lettres), torseur (accolade), matrice `( )` dessinées comme de vraies accolades avec un large espace pour écrire — un tap les pose à une taille par défaut, un glissé choisit la taille.
  - **Volumes 3D** avec arêtes cachées en tirets : cylindre, cône, sphère, demi-sphère, pyramide, pavé droit (parallélépipède rectangle), **tore**, **prisme triangulaire**, **tétraèdre** et **ellipsoïde**. Le prisme et le tétraèdre sont en perspective cavalière ; pour le tore et l'ellipsoïde, un vrai test de visibilité décide de ce qui passe derrière le volume (contour, équateur, méridien).
  - Formes et tampons sont des objets comme les images glissées : déplaçables, dupliquables, effaçables, recolorables, inclus dans le PDF vectoriel (tirets compris, net à tout zoom, même tournés).
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
Firebase, Google Drive et la connexion Google sont autorisés ; aucun script tiers, aucun script en ligne, pas d'iframe
étrangère), `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy` et HSTS. Il règle aussi le cache : `sw.js`, `precache.json` et `index.html`
ne sont jamais mis en cache (une mise à jour est vue tout de suite), les fichiers de `assets/` (nom avec empreinte)
le sont un an. **Si tu ajoutes un service externe** (police, script, API), ajoute son adresse dans la CSP, sinon le
navigateur le bloquera silencieusement (regarde la console du navigateur).

Rappel de ce qui est stocké où : les notes sont dans IndexedDB sur l'appareil ; les réglages et l'ID client OAuth Drive
dans `localStorage` (aucun mot de passe, aucune clé secrète) ; le jeton Google Drive (1 h) seulement en mémoire et dans `sessionStorage`, effacé à la fermeture de
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
- **Adresse vérifiée obligatoire** : un compte e-mail/mot de passe n'entre pas (et ne peut rien lire ni écrire dans
  Firestore) tant que le lien de validation reçu par e-mail n'a pas été cliqué. Les comptes Google sont vérifiés
  d'office.
- **Fermer la création de comptes** (le plus strict) : console Firebase → Authentication → Settings → *User actions* →
  décoche « Enable create (sign-up) ». Le bouton « Créer un compte » disparaît aussi dès que `VITE_ALLOWED_EMAILS` est
  rempli.

Ce verrou protège l'écran, pas le disque : les notes restent lisibles dans le stockage du navigateur par qui a
l'appareil et les outils de développement.

**Google ou e-mail, même compte.** Une adresse n'a qu'un compte, et les deux méthodes y mènent :
- mot de passe refusé parce que le compte a été créé avec Google : le bouton **« Continuer avec Google et ajouter ce
  mot de passe »** ouvre le compte par Google et lui ajoute le mot de passe tapé ;
- Google refusé parce que l'adresse a déjà un compte e-mail : le mot de passe ouvre le compte, et Google y est relié ;
- dans **Réglages → Compte et connexion** : « Ajouter un mot de passe » ou « Relier Google » (même adresse).

**Supprimer mon compte** (Réglages, tout en bas) : après avoir recopié `SUPPRIMER` et confirmé son identité (Google ou
mot de passe), l'appli déconnecte la sauvegarde Google Drive (autorisation révoquée), efface tout ce que le compte a
dans Firestore (partages, pages, fichiers, transcriptions, index, réglages), libère l'appareil (le prochain compte en
devient le propriétaire) puis supprime le compte Firebase. Les cahiers de l'appareil restent dans le navigateur.
Nécessite les règles Firestore à jour (lister ses propres partages, effacer `state/backup`).

### Règles Firestore

Les règles de sécurité sont dans `firestore.rules` : chaque compte **à l'adresse vérifiée** ne lit et n'écrit que
`users/<son uid>/…`, avec la forme exacte des documents de l'appli (types, tailles, identifiants) ; les liens de partage
`shares/<id>` sont lisibles par qui a l'identifiant, jamais listables, modifiables par leur seul auteur ; tout le reste
est fermé. **Elles ne s'appliquent qu'une fois publiées** :
console Firebase → Firestore Database → Règles → coller le fichier → Publier (ou
`npx firebase-tools deploy --only firestore:rules --project math-notes-pwa`).

## Sauvegarde hebdomadaire automatique sur Google Drive

Chaque dimanche vers 3 h (heure de Tunis ; 02:00–02:59 UTC), un serveur relit **tout Firestore** (dossiers,
cahiers, pages et traits, zones de texte, transcriptions, PDF et photos, tâches, écriture perso, réglages de
couleurs) et envoie dans le dossier **« Sauvegardes Math-Notes »** de ton Drive un fichier
`notes-maths-sauvegarde-AAAA-MM-JJ.json`, **au format exact de l'export manuel** (il se restaure avec
« Restaurer… » comme n'importe quelle sauvegarde).

Fiabilité :
- **Envoi reprenable** par morceaux de 8 Mo : une coupure ou une erreur de Google reprend là où Drive s'est
  arrêté, sans octet perdu ni envoyé deux fois ; une sauvegarde relancée le même jour remplace celle du jour.
- **Vérification** : la taille et l'empreinte MD5 calculées par Drive doivent être celles du fichier, sinon la
  sauvegarde est déclarée en échec. Chaque PDF est aussi vérifié (SHA-256) avant d'entrer dans la sauvegarde.
- **Firestore vide = échec**, jamais une sauvegarde vide présentée comme réussie.
- **Alerte dans l'appli** (bandeau rouge en haut, bouton « Relancer maintenant ») si la dernière sauvegarde a
  échoué, **ou si aucune n'a réussi depuis 8 jours** (planification arrêtée, variable manquante…). Le détail des
  erreurs est aussi dans le journal Vercel (Logs, préfixe `[sauvegarde]`).

Pourquoi Vercel Cron et pas Cloud Functions : les fonctions et la planification de Firebase exigent le forfait
payant Blaze ; Vercel Cron est gratuit. Et pourquoi une autorisation Google plutôt qu'un compte de service :
un compte de service ne peut pas écrire dans le Drive d'un compte Gmail personnel.

### Mise en service (une fois, ~15 minutes)

1. **Clé de lecture de Firestore** : console Firebase → ⚙ Paramètres du projet → *Comptes de service* →
   « Générer une nouvelle clé privée ». Garde le fichier JSON pour l'étape 3 — **ne le mets jamais dans le dépôt**.
2. **Client OAuth pour Drive** : [console.cloud.google.com](https://console.cloud.google.com) (projet `math-notes-pwa`)
   - *API et services* → *Bibliothèque* → activer **Google Drive API** ;
   - *Écran de consentement OAuth* : type Externe, portée `.../auth/drive.file`, puis **« Publier l'application »**
     (état *En production*). **Indispensable** : en mode *Test*, Google retire l'autorisation au bout de 7 jours
     et la sauvegarde échouerait dès le deuxième dimanche. La portée drive.file (l'appli ne voit que ses propres
     fichiers) ne demande aucune validation de Google ;
   - *Identifiants* → *Créer* → *ID client OAuth* → *Application Web*, URI de redirection autorisé :
     `https://math-notes-app-indol.vercel.app/api/drive-auth`.
3. **Variables Vercel** (Settings → Environment Variables, environnement *Production*) :

   | Variable | Valeur |
   |---|---|
   | `FIREBASE_SERVICE_ACCOUNT` | le contenu du fichier JSON de l'étape 1 (tel quel) |
   | `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | l'ID et le secret du client de l'étape 2 |
   | `BACKUP_OWNER_EMAIL` | ton adresse (le seul compte sauvegardé et autorisé à gérer la sauvegarde) |
   | `CRON_SECRET` | une longue chaîne aléatoire (Vercel la joint à chaque déclenchement du dimanche) |
   | `BACKUP_KEEP` | facultatif : nombre de sauvegardes gardées (ex. `12`) ; sans elle, tout est gardé |
   | `BACKUP_TIMEZONE` | facultatif : fuseau du nom de fichier (défaut `Africa/Tunis`) |

   Puis **redéploie** (les variables ne s'appliquent qu'aux nouveaux déploiements).
4. **Règles Firestore** : publie `firestore.rules` (il autorise la lecture du compte rendu de sauvegarde et la
   copie des réglages de couleurs).
5. **Dans l'appli** : Réglages → Cloud & Sauvegarde → synchronisation en temps réel **activée**, puis
   « Connecter Google Drive » (autorisation Google), puis « Sauvegarder maintenant » pour vérifier : le fichier
   apparaît dans « Sauvegardes Math-Notes ».

La sauvegarde copie **ce qui est dans Firestore** : un appareil sans synchronisation n'y figure pas, et un PDF de
plus de 50 Mo (non synchronisé) non plus.

## Sauvegarde Google Drive depuis l'appli (facultative, manuelle)

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
| `src/ai/` | Format des transcriptions (`blocks.ts`) et leur texte (`notesText.ts`, pour la recherche) |
| `src/render/` | Affichage KaTeX, tableaux tkz-tab, export LaTeX |
| `src/export/` | PDF vectoriel, PDF manuscrit |
| `src/pdf/` | Lecture des PDF importés (pdf.js) et couvertures des cahiers (`cover.ts` : miniature de la première page, gardée dans le Cache Storage) |
| `src/ocr/` | Texte des PDF et des scans : moteur Tesseract.js à la demande dans un Web Worker (`engine.ts`), texte d'une page — natif ou lu — mis en cache (`pageText.ts`), mots, recherche et copie (`textModel.ts`, testé), couche sélectionnable (`TextLayer.tsx`), correction au lasso (`correct.ts` ; effacement `inpaint.ts` dans `inpaint.worker.ts`, et mise en page `correctionModel.ts`, testés). Fichiers du moteur servis sous `ocr/<version>/` (plugin dans `vite.config.ts`) |
| `src/sync/` | Synchronisation : temps réel Firestore (`firestore.ts` : envois groupés, reprises après coupure, PDF et pages lourdes découpés en morceaux vérifiés par SHA-256 via `chunks.ts`) et Google Drive ; même fusion « le plus récent gagne » (`merge.ts`) |
| `api/` | Serveur (fonctions Vercel) : sauvegarde hebdomadaire sur Drive (`backup.ts`, planifiée dans `vercel.json`), connexion de Drive (`drive-auth.ts`) ; `_lib/backupCollect.ts` refait l'export manuel à partir de Firestore, `_lib/drive.ts` l'envoi reprenable vérifié (tous deux testés sans réseau) |
| `src/share/` | Partage en lecture seule par lien secret `/share/<id>` (publication incrémentale, lecteur public) |
| `src/auth/` | Accès réservé : qui a le droit d'entrer (`access.ts`, testé), la porte d'entrée (`useAccess.ts`), la déconnexion complète, la liaison Google / mot de passe (`linking.ts`) et la suppression du compte (`deleteAccount.ts`, logique testée dans `accountModel.ts`) |
| `src/db/backupFormat.ts` | Format du fichier de sauvegarde et sa validation (rien n'est écrit dans la base avant vérification) |
| `vercel.json` | En-têtes de sécurité (CSP…) et règles de cache du site en ligne |
| `src/components/` | Écrans : bibliothèque (`Library*.tsx`), éditeur, barre d'onglets, exports, mon écriture, réglages (`SettingsDialog.tsx` : deux cartes dans `settings/`, briques communes dans `settings/ui.tsx`), écran de connexion (`AuthPanel.tsx`), indicateur de synchro (`CloudIndicator.tsx`), pictogrammes (`icons.tsx`) et catalogue des tampons (`stamps.tsx`) |
| `src/index.css` | Point d'entrée des styles : Tailwind CSS, KaTeX et l'ancienne feuille `styles.css`, rangés en couches (voir ci-dessous) |
| `tests/` | Tests exécutés directement par Node (`npm test`) : anti-paume, formes, géométrie, feuilles, historique, bibliothèque, réponses du modèle, tableaux tkz-tab, rendu des maths, navigation, sauvegardes, fusion de la synchronisation |

### Les styles : Tailwind CSS et l'ancienne feuille

La bibliothèque est dessinée avec **Tailwind CSS** (v4, gratuit, ajouté à la compilation seulement : rien de plus dans l'appli). Le reste de l'appli garde son ancienne feuille de style, `src/styles.css`, et les écrans passeront à Tailwind un par un. Pour que les deux cohabitent :

- **pas de « Preflight »** (la remise à zéro de Tailwind) : elle changerait tous les écrans existants ; seuls le thème et les utilitaires sont importés (`src/index.css`) ;
- **des couches CSS** fixent qui gagne : `theme` < `vendor` (KaTeX) < `legacy` (`styles.css`) < `utilities` (Tailwind). Une classe Tailwind l'emporte donc toujours sur les règles générales de l'ancienne feuille (`button { padding… }`), sans `!important` ;
- **le thème sombre suit le système** (`dark:`), comme avant : seules la bibliothèque et les boîtes de dialogue s'assombrissent, l'éditeur garde son papier clair ;
- **les recettes partagées** (bouton en verre, panneau de verre…) sont dans `src/components/libraryStyles.ts`, et ce que la bibliothèque calcule (arbre des dossiers, chemin, compteurs, papier en miniature) dans `src/components/libraryModel.ts`, testé sous Node.
