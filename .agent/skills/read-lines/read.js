const fs = require('fs');
const path = require('path');

const file = process.argv[2];
const startLine = parseInt(process.argv[3], 10);
const endLine = parseInt(process.argv[4], 10);

if (!file || isNaN(startLine) || isNaN(endLine)) {
    console.error("Usage: node read.js <fichier> <ligne_debut> <ligne_fin>");
    process.exit(1);
}

try {
    const filePath = path.resolve(file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    // On extrait uniquement le bloc de lignes demandé
    const extracted = lines.slice(startLine - 1, endLine).join('\n');
    console.log(extracted);
} catch (error) {
    console.error("Erreur :", error.message);
}