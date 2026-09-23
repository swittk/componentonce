import { copyFile } from "node:fs/promises";
await copyFile(new URL("./src/workbench.css", import.meta.url), new URL("./dist/workbench.css", import.meta.url));
