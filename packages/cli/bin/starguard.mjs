#!/usr/bin/env node
// Ponto de entrada do binário. Fino de propósito: tudo o que decide alguma
// coisa está em `src/main.ts`, que tem teste. Aqui só se traduz o desfecho em
// código de saída — e é isso que o CI lê.
import { main } from "../dist/main.js";

process.exitCode = await main(process.argv.slice(2));
