// Registers the resolve hook that lets Node import the dashboard's
// browser-style module paths.

import { register } from "node:module";

register("./moduleLoader.mjs", import.meta.url);
