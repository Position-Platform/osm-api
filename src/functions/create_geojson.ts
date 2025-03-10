import { GeoJsonCreator } from './GeoJsonCreator';
import { Logger } from './logger';

// Export d'une fonction simple pour la compatibilité avec le code existant
export function createGeoJson(
  tag: string,
  country: string,
  identifiant: string,
  cb: (err: any, result: any) => void
) {
  const logger = Logger.getInstance();
  const creator = new GeoJsonCreator(logger);

  creator
    .createGeoJson(tag, country, identifiant)
    .then((result) => {
      if (result.success) {
        cb(null, {
          features_count: result.featuresCount,
          save_path: `/download/${country}/${identifiant}.geojson`
        });
      } else {
        cb(result.error, {
          error: result.error
        });
      }
    })
    .catch((error) => {
      cb(error, { error });
    });
}

// Fonction utilitaire pour transformer un fichier OSM PBF en série de GeoJSON
export async function generateCategoryGeoJsons(
  country: string,
  categories: (
    | {
        id: number;
        nom: string;
        id_categorie: number;
        tags_osm: string;
      }
    | {
        id: number;
        nom: string;
        id_categorie: number;
        tags_osm?: undefined;
      }
  )[],
  options: any = {}
): Promise<any> {
  const logger = Logger.getInstance();
  const creator = new GeoJsonCreator(logger);

  logger.info(
    `Génération de GeoJSON pour ${categories.length} catégories dans ${country}`
  );

  const tasks = categories.map((category) => ({
    tag: category.tags_osm!,
    country,
    identifiant: category.id.toString(),
    options
  }));

  return await creator.createBatch(tasks);
}
