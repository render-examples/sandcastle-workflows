// One-time setup: import an image with Node and git as the sandbox image.
// Claude Code is installed at sandbox start by the hook in src/config.ts.
//
//   npm run import-image

import { Render } from "@renderinc/sdk";
import { SANDBOX_IMAGE } from "../src/config.js";

const SOURCE_IMAGE = "docker.io/library/node:24-bookworm";

const sandboxes = new Render().sandboxes;

// Sandboxes are created in the default group, so the image goes there too.
const groups = await sandboxes.listGroups();
const defaultGroup = groups.find(({ sandboxGroup }) => sandboxGroup.isDefault)?.sandboxGroup;
// The first group in a workspace becomes its default.
const sandboxGroupId = defaultGroup?.id ?? (await sandboxes.createGroup({ name: "default" })).id;

console.log(`Importing ${SOURCE_IMAGE} as "${SANDBOX_IMAGE}" into ${sandboxGroupId}...`);
const image = await sandboxes.images.import({ sandboxGroupId, name: SANDBOX_IMAGE, source: SOURCE_IMAGE });
const ready = await sandboxes.images.waitUntilReady({ sandboxGroupId, imageId: image.id });
console.log(`Image ${ready.id} is ready.`);
