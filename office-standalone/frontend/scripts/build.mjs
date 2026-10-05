import {build} from 'vite';
import {copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

await build();
await copyFile(fileURLToPath(new URL('../../web/3d/index.html',import.meta.url)),fileURLToPath(new URL('../../web/index.html',import.meta.url)));
console.log('Hermes HQ frontend built for the existing local Office server.');
