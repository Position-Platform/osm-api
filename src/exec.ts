// Importer les modules nécessaires
import { exec } from 'child_process';

// Définir les commandes à exécuter
const osm2positionCommand = 'npm run generategeojson';
const insertDataCommand = 'npm run insertdata';

// Fonction pour exécuter une commande shell
function executeCommand(command: string) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(
          `Erreur lors de l'exécution de la commande : ${error.message}`
        );
        reject(error);
      }
      if (stderr) {
        console.error(`Erreur lors de l'exécution de la commande : ${stderr}`);
        reject(stderr);
      }
      console.log(`Résultat de la commande : ${stdout}`);
      resolve(stdout);
    });
  });
}

// Fonction principale
async function main() {
  try {
    // Exécuter osm2position
    console.log('Exécution de osm2position...');
    await executeCommand(osm2positionCommand);
    console.log('osm2position terminé avec succès.');

    // Exécuter insertData
    console.log('Exécution de insertData...');
    await executeCommand(insertDataCommand);
    console.log('insertData terminé avec succès.');
  } catch (error) {
    console.error("Une erreur s'est produite :", error);
  }
}

// Appeler la fonction principale
main();
