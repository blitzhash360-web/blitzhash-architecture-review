#!/usr/bin/env node
import { main } from '../src/cli.mjs';

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(`arch-review: ${e.message}`); process.exitCode = 2; });
