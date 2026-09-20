---
name: smart-grep
description: Recherche l'utilisation d'un mot-clé, d'une variable ou d'un composant dans tout le projet (dossier src par défaut) de manière ultra-optimisée pour les tokens.
---

# Localisateur de Contexte (Smart Grep)

## Goal
Trouver où une fonction, un état ou un composant est appelé sans charger l'intégralité du projet en mémoire.

## Instructions
1. Utilise toujours cet outil au lieu d'une commande système comme `grep` ou `findstr`.
2. Le script renvoie le chemin du fichier, le numéro de ligne et un extrait de code tronqué.
3. Si un fichier t'intéresse dans les résultats, utilise ensuite `read-lines` pour l'inspecter.

## Execution
Format de la commande : `node ./.agent/skills/smart-grep/search.js [MOT_CLÉ] [DOSSIER_OPTIONNEL]`

## Example
Pour chercher où le bouton 'Convertir' est appelé :
`node ./.agent/skills/smart-grep/search.js "Convertir"`