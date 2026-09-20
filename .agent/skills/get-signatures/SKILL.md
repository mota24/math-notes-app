---
name: get-signatures
description: Extrait uniquement la structure (fonctions, types, interfaces, exports) d'un fichier TypeScript/JavaScript sans charger la logique interne.
---

# Extracteur de Signatures

## Goal
Comprendre l'architecture d'un fichier (composants, props, exports) sans consommer de tokens en lisant le fichier complet.

## Instructions
1. Utilise systématiquement cet outil avant de modifier un fichier inconnu pour comprendre sa structure.
2. N'utilise `read-lines` ou `cat` que si tu as besoin de voir la logique interne d'une fonction spécifique découverte via cet outil.

## Execution
Format de la commande : `node ./.agent/skills/get-signatures/scan.js [CHEMIN_FICHIER]`

## Example
Pour analyser la structure de l'éditeur :
`node ./.agent/skills/get-signatures/scan.js src/NotebookEditor.tsx`