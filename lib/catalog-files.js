import { mkdirSync, writeFileSync, renameSync } from 'node:fs';

export function writeCatalogFiles(directory, catalog, filename = 'catalog.json') {
  mkdirSync(`${directory}/compatibility`, { recursive: true });
  const write = (path, value) => {
    writeFileSync(`${path}.tmp`, JSON.stringify(value));
    renameSync(`${path}.tmp`, path);
  };
  const products = catalog.products.map(product => {
    if (!/^\d{9,15}$/.test(product.id)) throw new Error('Invalid product ID');
    if (!Array.isArray(product.compatibility)) return product;
    const { compatibility, ...summary } = product;
    write(`${directory}/compatibility/${product.id}.json`, { id: product.id, rows: compatibility });
    return { ...summary, compatibilityCount: compatibility.length };
  });
  // Publish the index after its detail files exist.
  write(`${directory}/${filename}`, { ...catalog, products });
}
