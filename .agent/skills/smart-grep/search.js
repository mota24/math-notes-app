const fs = require('fs');
const path = require('path');

const keyword = process.argv[2];
const searchDir = process.argv[3] || 'src';

if (!keyword) {
    console.error("Usage: node search.js <mot-cle> [dossier]");
    process.exit(1);
}

function searchFiles(dirPath) {
    let results = [];
    const files = fs.readdirSync(dirPath);
    
    for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
            results = results.concat(searchFiles(fullPath));
        } else if (stat.isFile() && /\.(tsx|ts|js|jsx|css)$/.test(file)) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            lines.forEach((line, index) => {
                if (line.includes(keyword)) {
                    // On coupe la ligne à 100 caractères max pour économiser les tokens
                    results.push(`${fullPath}:${index + 1}: ${line.trim().substring(0, 100)}`);
                }
            });
        }
    }
    return results;
}

try {
    const matches = searchFiles(path.resolve(searchDir));
    if (matches.length === 0) {
        console.log(`Aucun résultat trouvé pour "${keyword}".`);
    } else {
        console.log(matches.slice(0, 30).join('\n'));
        if (matches.length > 30) {
            console.log(`\n... et ${matches.length - 30} autres résultats masqués pour économiser le contexte.`);
        }
    }
} catch (error) {
    console.error("Erreur :", error.message);
}