import occtImportJs from './occt-import-js.js';

let occtPromise;
function getOcct() {
  if (!occtPromise) occtPromise = occtImportJs();
  return occtPromise;
}

self.onmessage = async ({ data }) => {
  const { id, format, buffer, params } = data;
  try {
    const occt = await getOcct();
    const bytes = new Uint8Array(buffer);
    let result;
    if (format === 'brep') result = occt.ReadBrepFile(bytes, params ?? null);
    else if (format === 'iges') result = occt.ReadIgesFile(bytes, params ?? null);
    else result = occt.ReadStepFile(bytes, params ?? null);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
