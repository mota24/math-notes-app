const fs = require('fs');
const path = require('path');

const file = process.argv[2];

if (!file) {
    console.error("Usage: node scan.js <fichier>");
    process.exit(1);
}

try {
    const filePath = path.resolve(file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    // Filtre les lignes qui déclarent des fonctions, classes, types ou exports
    const signatures = lines.filter(line => 
        /^(?:export\s+)?(?:async\s+)?(?:function|const|let|class|interface|type)\s+/.test(line.trim())
    );
    
    console.log(signatures.join('\n'));
} catch (error) {
    console.error("Erreur :", error.message);
}