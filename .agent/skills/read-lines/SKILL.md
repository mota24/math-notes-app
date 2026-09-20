---
name: read-lines
description: Lit un segment spécifique d'un fichier au lieu de charger tout le code. À utiliser SYSTEMATIQUEMENT pour explorer des fichiers de plus de 100 lignes afin d'économiser des tokens.
---

# Extracteur Chirurgical (Read Lines)

## Goal
Éviter l'explosion du quota de tokens en lisant uniquement les lignes pertinentes d'un gros fichier (comme InkCanvas.tsx ou NotebookEditor.tsx).

## Instructions
1. Ne jamais lire intégralement un fichier long.
2. Si tu dois inspecter une fonction précise, utilise ce script pour ne lire que la portion nécessaire.
3. Exécute le script via Node.js en fournissant le chemin, la ligne de début et la ligne de fin.

## Execution
Format de la commande : `node ./.agent/skills/read-lines/read.js [CHEMIN_FICHIER] [LIGNE_DÉBUT] [LIGNE_FIN]`

## Example
Si tu dois lire les lignes 45 à 60 de src/InkCanvas.tsx :
`node ./.agent/skills/read-lines/read.js src/InkCanvas.tsx 45 60`