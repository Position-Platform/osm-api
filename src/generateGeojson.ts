import { generateCategoryGeoJsons } from './functions/create_geojson';
import { categories } from './functions/sc';

async function generateGeoJson() {
  // Traitement par lots
  await generateCategoryGeoJsons('cameroun', categories);
}

generateGeoJson();
